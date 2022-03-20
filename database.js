"use strict";

const sqlite3 = require("sqlite3");
const util = require("util");
const os = require("os");
const fs = require("fs");

const DB_PATH = "./database/database.db";
const DB_BAK1_PATH = "./database/database.db.bak1";
const DB_BAK2_PATH = "./database/database.db.bak2";

let db = null;

module.exports = {
  load,
  backup,
  restoreBackup,
  beginTransaction,
  endTransaction,
  getLatestHeight,
  getUtxos,
  removeUtxos,
  insertUtxos,
  getUtxo,
};

function load() {
  db = new sqlite3.Database(DB_PATH);
}

function backup() {
  // Move last backup to last last backup.
  if (fs.existsSync(DB_BAK1_PATH)) {
    fs.copyFileSync(DB_BAK1_PATH, DB_BAK2_PATH);
  }

  // Backup current to last backup.
  db.close();
  fs.copyFileSync(DB_PATH, DB_BAK1_PATH);

  // Reload.
  load();
}

function restoreBackup() {
  db.close();
  // Rollback to last last backup.
  fs.copyFileSync(DB_BAK2_PATH, DB_BAK1_PATH);
  fs.copyFileSync(DB_BAK2_PATH, DB_PATH);
  // Delete backups.
  fs.unlinkSync(DB_BAK2_PATH);
  // Reload.
  load();
}

function beginTransaction() {
  return util.promisify(db.run.bind(db))(`BEGIN TRANSACTION`);
}

function endTransaction() {
  return util.promisify(db.run.bind(db))(`END TRANSACTION`);
}

async function getLatestHeight() {
  return (
    await util.promisify(db.get.bind(db))(`SELECT MAX(height) FROM utxos`)
  )["MAX(height)"];
}

function getUtxo(txid, index) {
  return util.promisify(db.get.bind(db))(
    `SELECT txid, idx as 'index', height, address, amount FROM utxos WHERE txid=? AND idx=?`,
    [txid, index]
  );
}

function getUtxos(address) {
  return util.promisify(db.all.bind(db))(
    `SELECT txid, idx as 'index', height, amount FROM utxos WHERE address=?`,
    [address]
  );
}

function removeUtxos(utxos) {
  if (utxos.length === 0) {
    return;
  }
  return util.promisify(db.run.bind(db))(
    `DELETE FROM utxos WHERE (txid, idx) IN (VALUES ${utxos
      .map((x) => '("' + x.txid + '",' + x.index + ")")
      .join(",")})`
  );
}

function insertUtxos(utxos) {
  if (utxos.length === 0) {
    return;
  }
  return util.promisify(db.run.bind(db))(
    `INSERT INTO utxos (txid, idx, height, address, amount) VALUES ${utxos
      .map(
        (x) =>
          '("' +
          x.txid +
          '",' +
          x.index +
          "," +
          x.height +
          ',"' +
          x.address +
          '",' +
          x.amount +
          ")"
      )
      .join(",")}`
  );
}
