const cors = require('cors');
const db = require("./database");
const dingo = require("./dingo");
const express = require('express');
const fs = require('fs');
const https = require('https');
const rateLimit = require("express-rate-limit");
const tls = require('tls');

function asyncHandler(fn) {
  return async function(req, res) {
    try {
      return await fn(req, res);
    } catch (err) {
      console.log(`>>>>> ERROR START [${(new Date()).toUTCString()}] >>>>>\n`);
      console.log(err.stack + '\n' + req.path + '\n' +
                  JSON.stringify(req.body, null, 2) + '\n');
      console.log('<<<<<< ERROR END <<<<<<\n');
      res.status(500).json(err.stack);
    }
  };
}

// In the same block, the same UTXO can appear in both the vout of some
// tx and the vin of some other tx. Take care to add first before deleting,
// so that these duplicates are removed.
const diff = async (height) => {
  const newUtxos = [];
  const delUtxos = [];

  const block = await dingo.getBlock(await dingo.getBlockHash(height));
  for (const txid of block.tx) {
    const tx = await dingo.decodeRawTransaction(
      await dingo.getRawTransaction(txid)
    );

    for (const vout of tx.vout) {
      if (vout.scriptPubKey.type !== "nulldata") {
        if (vout.scriptPubKey.addresses.length !== 1) {
          console.log(vout.scriptPubKey);
          throw new Error("INVALID ADDRESSES");
        }
        newUtxos.push({
          txid: tx.txid,
          vout: vout.n,
          height: height,
          address: vout.scriptPubKey.addresses[0],
          amount: dingo.toSatoshi(vout.value),
        });
      }
    }

    for (const vin of tx.vin) {
      if (!("coinbase" in vin)) {
        delUtxos.push({ txid: vin.txid, vout: vin.vout });
      }
    }

  }


  return { newUtxos: newUtxos, delUtxos: delUtxos };
};

(async () => {

  console.log('Loading database...');
  db.load("./database/database.db");

  let height = await db.getLatestHeight();

  // Initial sync: Use memory to speed up diff accumulation.
  if (height === null) {
    console.log('Starting initial sync...');

    height = 1; // Start from height = 1.
    const targetHeight = (await dingo.getBlockchainInfo()).blocks;

    const utxos = {};
    while (height <= targetHeight) {
      const { delUtxos, newUtxos } = await diff(height);
      for (const utxo of newUtxos) {
        utxos[utxo.txid + "|" + utxo.vout] = utxo;
      }
      for (const utxo of delUtxos) {
        delete utxos[utxo.txid + "|" + utxo.vout];
      }

      if (height % 1000 === 0) {
        console.log(
          "[Initial sync] Height = " + height + " / " + targetHeight
        );
      }
      height += 1;
    }

    // Write to database.
    const utxoList = Object.values(utxos);
    console.log(`Writing ${Object.keys(utxoList).length} UTXOs...`);
    for (let i = 0; i < Object.keys(utxoList).length; i += 1000) {
      console.log(`  Indexes [${i}, ${i + 1000})`);
      await db.insertUtxos(Object.values(utxoList.slice(i, i + 1000)));
    }
    console.log('Initial sync complete.');

  } else {
    height += 1; // Fetch from next block.
  }

  // Live sync: write directly to database.
  console.log('Starting live sync...');
  const liveStep = async () => {
    const targetHeight = (await dingo.getBlockchainInfo()).blocks;
    while (height <= targetHeight) {
      const { delUtxos, newUtxos } = await diff(height);
      await db.insertUtxos(newUtxos);
      await db.removeUtxos(delUtxos);
      console.log(
        "[Live sync] Height = " + height + " / " + targetHeight
      );
      height += 1;
    }
    setTimeout(liveStep, 1000);
  };
  liveStep();

  // API.
  const app = express();
  app.use(cors());
  app.use(express.json());
  const createRateLimit = (windowS, count) => rateLimit({ windowMs: windowS * 1000, max: count });

  app.get('/utxos/:address', createRateLimit(1, 5), asyncHandler(async (req, res) => {
    const address = req.params.address;
    res.send(await db.getUtxos(address));
  }));

  server = https.createServer({
    key: fs.readFileSync('/etc/letsencrypt/live/bewp0.dingocoin.org/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/bewp0.dingocoin.org/fullchain.pem'),
    SNICallback: (domain, cb) => {
      cb(null, tls.createSecureContext({
        key: fs.readFileSync('/etc/letsencrypt/live/bewp0.dingocoin.org/privkey.pem'),
        cert: fs.readFileSync('/etc/letsencrypt/live/bewp0.dingocoin.org/fullchain.pem'),
      }));
    }
  }, app).listen(8443, () => {
    console.log(`Started on port 8443`);
  });

})();
