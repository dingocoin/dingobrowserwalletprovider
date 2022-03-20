const cors = require("cors");
const db = require("./database");
const dingo = require("dingocoin-js");
const express = require("express");
const rateLimit = require("express-rate-limit");
const os = require("os");

function asyncHandler(fn) {
  return async function (req, res) {
    try {
      return await fn(req, res);
    } catch (err) {
      console.log(`>>>>> ERROR START [${new Date().toUTCString()}] >>>>>\n`);
      console.log(err);
      console.log("<<<<<< ERROR END <<<<<<\n");
      res.status(500).json(err.stack);
    }
  };
}

// In the same block, the same UTXO can appear in both the vout of some
// tx and the vin of some other tx. Take care to add first before deleting,
// so that these duplicates are removed.
const diff = async (height, block) => {
  const newUtxos = [];
  const delUtxos = [];

  for (const tx of block.txs) {
    for (const vout of tx.vouts) {
      if (vout.type !== "nulldata") {
        newUtxos.push({
          txid: vout.txid,
          index: vout.index,
          height: height,
          address: vout.address,
          amount: dingo.utils.toSatoshi(vout.value),
        });
      }
    }

    for (const vin of tx.vins) {
      if (vin.type !== "coinbase") {
        delUtxos.push({ txid: vin.txid, index: vin.index });
      }
    }
  }

  return { newUtxos: newUtxos, delUtxos: delUtxos };
};

(async () => {
  console.log("Loading database...");
  db.load();

  let height = await db.getLatestHeight();
  const rpc = dingo.rpc.fromCookie(
    "~/.dingocoin/.cookie".replace("~", os.homedir)
  );
  const acc = new dingo.Accumulator(
    rpc,
    height + 1,
    async (height, block) => {
      const { delUtxos, newUtxos } = await diff(height, block);
      await db.beginTransaction();
      await db.insertUtxos(newUtxos);
      await db.removeUtxos(delUtxos);
      await db.endTransaction();
      console.log("[Live sync] Height = " + height);
      if (height % 200 === 0) {
        db.backup();
        console.log("  [Backup] Completed");
      }
    },
    0,
    async (height) => {
      console.log("[Rollback] Triggered");
      db.restoreBackup();
      console.log("  [Backup] Restored");
      return (await db.getLatestHeight()) + 1;
    }
  );

  // API.
  const app = express();
  app.use(cors());
  app.use(express.json());
  const createRateLimit = (windowS, count) =>
    rateLimit({ windowMs: windowS * 1000, max: count });

  app.get(
    "/utxos/:address",
    createRateLimit(1, 5),
    asyncHandler(async (req, res) => {
      const address = req.params.address;
      console.log(`GET ${address}`);
      res.send(await db.getUtxos(address));
    })
  );

  app.get(
    "/mempool/:address",
    createRateLimit(1, 5),
    asyncHandler(async (req, res) => {
      const address = req.params.address;
      console.log(`MEMPOOL ${address}`);

      const mempool = await dingo.getRawMempool();
      let change = 0n;

      for (const txid of mempool) {
        const tx = await dingo.decodeRawTransaction(
          await dingo.getRawTransaction(txid)
        );
        for (const vin of tx.vin) {
          const utxo = await db.getUtxo(vin.txid, vin.vout);
          if (utxo === undefined) {
            console.log("Failure: ", vin);
          } else {
            if (utxo.address === address) {
              change -= BigInt(utxo.amount);
            }
          }
        }
        for (const vout of tx.vout) {
          if (vout.scriptPubKey.type === "pubkeyhash") {
            if (vout.scriptPubKey.addresses[0] === address) {
              change += BigInt(dingo.toSatoshi(vout.value));
            }
          }
        }
      }

      res.send({ change: change.toString() });
    })
  );

  app.post(
    "/sendrawtransaction",
    createRateLimit(1, 1),
    asyncHandler(async (req, res) => {
      const data = req.body;
      console.log(`SEND ${data.tx}`);
      await dingo
        .sendRawTransaction(data.tx)
        .then((r) => {
          res.send({ txid: r });
        })
        .catch((e) => {
          res.send(e);
        });
    })
  );

  acc.start();
  app.listen(8080, () => {
    console.log(`Started on port 80`);
  });
})();
