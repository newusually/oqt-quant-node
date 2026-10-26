// L7 api/okx · 顶层接口，分发到 modules/okx/api（一比一转换原 OKX 数据接口）
'use strict';
const okxApi = require('../modules/okx/api');
async function handle(ep, q) { return await okxApi.handle(ep, q); }
module.exports = { handle };
