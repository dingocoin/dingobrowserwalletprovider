const dingo = require("./dingo");
const db = require("./database");


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

})();
