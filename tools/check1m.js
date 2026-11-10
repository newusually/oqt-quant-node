'use strict';
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/home/ubuntu/oqt-quant-node/data/okx/updown.sqlite');
const s = db.prepare("SELECT count(*) c, min(total) mn, max(total) mx, min(ts) mint, max(ts) maxt FROM updown WHERE grain='1m'").get();
console.log(JSON.stringify({
  rows: s.c,
  total_min: s.mn, total_max: s.mx,
  range_from: s.mint ? new Date(s.mint).toISOString().slice(0,10) : null,
  range_to: s.maxt ? new Date(s.maxt).toISOString().slice(0,10) : null,
  all_full: s.c > 40000 && s.mx >= 280
}, null, 2));
