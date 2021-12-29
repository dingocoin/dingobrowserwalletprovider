"use strict";

const sqlite3 = require("sqlite3");
const util = require("util");

let db = null;
let dbLock = null;

module.exports = {
  load,
  getLatestHeight,
  removeUtxos,
  insertUtxos,
};

function load(path) {
  db = new sqlite3.Database(path);
}

async function getLatestHeight() {
  return (await util.promisify(db.get.bind(db))(
    `SELECT MAX(height) FROM utxos`
  ))['MAX(height)'];
}

function removeUtxos(utxos) {
  if (utxos.length === 0) {
    return;
  }
  return util.promisify(db.run.bind(db))(
    `DELETE FROM utxos WHERE (txid, vout) IN (VALUES ${utxos
      .map((x) => '("' + x.txid + '",' + x.vout + ')')
      .join(",")})`
  );
}

function insertUtxos(utxos) {
  if (utxos.length === 0) {
    return;
  }
  return util.promisify(db.run.bind(db))(`INSERT INTO utxos (txid, vout, height, address, amount) VALUES ${utxos
      .map((x) => '("' + x.txid + '",' + x.vout + ',' + x.height + ',"' + x.address + '",' + x.amount + ')')
      .join(",")}`);
}
