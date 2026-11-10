/* ============================================================================
 * modules/okx/engines/insts.js —— 合约信息库【介绍/概念 + 分类 → SQLite】
 * ----------------------------------------------------------------------------
 * ★范围：只收录【加密货币】合约，概念库同样只保留加密货币条目
 *
 * ★设计：
 *   1) 全市场加密永续合约 → data/okx/insts.sqlite
 *      (instId/sym/name/sector/concept/tags/lever/updated)
 *   2) 概念 = 内置手写库(主流币) + 按板块模板生成(其余)
 *   3) 分类口径 = universe.sectorOf()（加密生态分类）
 *   4) 幂等 upsert：重启/重拉合约列表只增量更新概念与分类
 * ========================================================================== */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '../../../');
const DB_DIR = path.join(ROOT, 'data/okx');
const DB_FILE = path.join(DB_DIR, 'insts.sqlite');

/* ---------------- 内置概念库（手写 · 主流加密货币，其余按模板生成） ---------------- */
const C = {
  /* ── 主流公链 ── */
  BTC: '比特币（Bitcoin），全球第一个去中心化加密货币，市值第一，被视为数字黄金，OKX 永续最深流动性',
  ETH: '以太坊（Ethereum），智能合约平台龙头，DeFi/NFT/L2 生态基础设施，Gas 由 ETH 支付',
  SOL: 'Solana，高性能单链公链，高 TPS 低费用，meme 与 DePIN 生态活跃',
  BNB: '币安币（BNB），币安交易所平台币，用于手续费抵扣与 BNB Chain Gas',
  XRP: '瑞波币（XRP），Ripple 跨境支付协议代币，主打机构清算',
  DOGE: '狗狗币（Dogecoin），首个 meme 币，马斯克概念，社区文化驱动',
  ADA: '艾达币（Cardano），学术派 PoS 公链，Ouroboros 共识',
  AVAX: '雪崩协议（Avalanche），子网架构高性能公链，DeFi 生态',
  LINK: 'Chainlink，去中心化预言机龙头，为合约提供链下数据',
  DOT: '波卡（Polkadot），跨链异构多链协议，中继链+平行链',
  TRX: '波场（TRON），USDT 最大流通链',
  ATOM: 'Cosmos，跨链 IBC 协议枢纽，主权链互操作',
  NEAR: 'NEAR Protocol，分片式高性能公链，人本位账户抽象',
  APT: 'Aptos，Move 语言新公链，Meta 系团队',
  SUI: 'Sui，Move 语言新公链，对象模型高并发',
  TON: 'Toncoin，Telegram 集成公链，小程序生态',
  ALGO: 'Algorand，PoS 公库，纯权益证明共识，CBDC 合作',
  HBAR: 'Hedera，Hashgraph 共识，企业级高吞吐公链',
  XLM: 'Stellar，支付导向公链，锚定法币通道',
  ETC: '以太坊经典，ETH 分叉，PoW 坚持者',
  EGLD: 'MultiversX（Elrond），自适应分片公链',
  ZIL: 'Zilliqa，高吞吐分片公链，Layer 1 金融基础设施',
  KSM: 'Kusama，波卡金丝雀网络，治理实验田',
  IOTA: 'IOTA，DAG 账本，物联网机器支付',
  NEO: 'NEO，数字资产与智能合约双链架构，dBFT 共识',
  CFX: 'Conflux，Tree-Graph 共识高吞吐公链，国产代表',
  CELO: 'Celo，移动优先支付公链，Gas 稳定币计价',
  ONE: 'Harmony，异步 BFT 快速终局公链，跨链金融',
  MINA: 'Mina Protocol，zk-SNARK 轻量共识，数据压缩链',
  FLOW: 'Flow，NBA Top Shot 背后的链上游戏平台',
  ZEN: 'Horizen（ZEN），隐私向零知识证明公链',
  ZETA: 'ZetaChain，跨链互操作性基础设施，Omnichain',
  LUNA: 'Terra，算法稳定币与合成资产生态',
  TURBO: 'Turbo，虚拟狗题材 meme 币',
  /* ── 扩容层 ── */
  ARB: 'Arbitrum，以太坊 L2 乐观 Rollup，龙头',
  OP: 'Optimism，以太坊 L2，OP Stack 超级链',
  STRK: 'StarkWare，zk-rollup 原生 L2',
  ZK: 'zkSync，zk-rollup 以太坊扩容，ZK 生态代表',
  ZKP: 'zkSpace，基于 ZK 的扩容基础设施',
  LINEA: 'Linea，ConsenSys zkEVM',
  METIS: 'Metis，超级链（Superchain）代表，源自 Arbitrum',
  AZTEC: 'Aztec，隐私优先 zk-rollup，Layer 2',
  /* ── DeFi ── */
  UNI: 'Uniswap，DEX 龙头，AMM 自动做市，UNI 治理代币',
  AAVE: 'Aave，去中心化借贷龙头协议，多链部署',
  MKR: 'Maker（SKY），DAI 稳定币发行协议，RWA 国债背书',
  CRV: 'Curve，稳定币 DEX，ve 代币经济学',
  LDO: 'Lido，以太坊质押龙头，stETH 流动性凭证',
  PENDLE: 'Pendle，收益代币化协议，YT/PT',
  MORPHO: 'Morpho，机构级无抵押借贷与金库',
  ENA: 'Ethena，合成美元 USDe，Delta 中性对冲稳定币',
  SKY: 'Sky（Maker），USDS 稳定币与 RWA 借贷协议',
  INJ: 'Injective，金融衍生品链，订单簿式 DEX',
  DYDX: 'dYdX，去中心化永续合约龙头',
  SNX: 'Synthetix，合成资产协议，衍生品流动性层',
  COMP: 'Compound，老牌借贷协议',
  SUSHI: 'SushiSwap，Uniswap 分叉，多链 DEX',
  '1INCH': '1inch，DEX 聚合器',
  GMX: 'GMX，Arbitrum 去中心化永续',
  ETHFI: 'Ether.fi，流动性再质押协议',
  EIGEN: 'EigenLayer，再质押协议，以太坊安全租赁',
  LQTY: 'Liquidity Protocol，抵押借贷与流动性仓位管理',
  JUP: 'Jupiter，Solana DEX 聚合器',
  JTO: 'Jito，Solana MEV 质押协议',
  RAY: 'Raydium，Solana AMM 与订单簿 DEX',
  BLEND: 'Blend，Blur 借贷协议的独立品牌',
  YFI: 'Yearn Finance，DeFi 收益聚合器鼻祖',
  /* ── Meme ── */
  SHIB: '柴犬币（Shiba Inu），以太坊头部 meme 币，Shibarium L2',
  PEPE: '佩佩蛙（Pepe），以太坊头部 meme 币，无实质应用纯社区',
  WIF: 'dogwifhat，Solana meme 币，戴帽柴犬',
  BONK: 'Bonk，Solana 生态 meme 币，社区空投起家',
  FLOKI: 'Floki Inu，马斯克梗 meme 币',
  MEME: 'MemeCoin，社区 meme 叙事',
  TRUMP: 'TRUMP（特朗普代币），政治 meme 币',
  PNUT: 'Pudgy Penguin 主题 meme 币',
  MOODENG: 'Moodeng，小狗 memecoin 叙事',
  PENGU: 'Pudgy Penguins，蓝筹 NFT 项目代币化，玩具 IP',
  FARTCOIN: 'Fartcoin，Solana 病毒式 meme 币',
  POPCAT: 'Popcat，Solana 爆火表情包 meme 币',
  BOME: 'BOOK OF MEME，Solana meme 生态聚合项目',
  BRETT: 'Brett，Base 链上的 meme 币',
  NEIRO: 'Neiro，Solana 双 meme 叙事（原 doge2）',
  SPX: 'SPX6900，meme 币生态新叙事（非标普500）',
  JELLYJELLY: 'JellyJelly，Solana 经典老 meme',
  MEW: 'cat in a dogs world，Solana meme 币',
  /* ── AI ── */
  FET: 'Fetch.ai / ASI，AI 代理经济体',
  RENDER: 'Render Network，去中心化 GPU 渲染，AI 算力叙事',
  TAO: 'Bittensor，去中心化 AI 网络，子网激励',
  VIRTUAL: 'Virtuals Protocol，AI 代理发行平台',
  AIXBT: 'AIXBT，AI 加密投研代理 meme 币',
  AI: 'Sora，OpenAI 视频生成同名代币',
  WLD: 'Worldcoin，World ID 虹膜身份，OpenAI 创始人项目',
  IRYS: 'Iris，AI 数据可用性基础设施',
  KAITO: 'KAITO，AI 驱动的信息与数据平台',
  KGEN: 'Kigen，AI Agent 生成平台',
  KII: 'Kii，AI 应用链',
  KITE: 'Kite，AI Agent 支付与身份层',
  DGAI: 'DeFAI，AI 与去中心化金融融合协议',
  /* ── 基础设施 ── */
  AR: 'Arweave，永久存储协议',
  PYTH: 'Pyth Network，高频预言机',
  ARKM: 'Arkham，链上情报分析平台代币',
  GRT: 'The Graph，去中心化索引与数据查询协议',
  NMR: 'Numeraire，链上数据衍生品与预测市场',
  API3: 'API3，预言机与去中心化 API 基础设施',
  FIL: 'Filecoin，去中心化存储龙头',
  THETA: 'Theta Network，去中心化视频',
  LPT: 'Livepeer，去中心化视频转码',
  ENS: 'ENS，以太坊域名服务',
  UMA: 'UMA，乐观预言机与预测市场协议',
  WCT: 'Wormhole，跨链消息与资产桥',
  ORDI: 'ORDI，比特币首个 BRC-20 铭文代币',
  SATS: 'SATS，BRC-20 铭文 meme',
  /* ── 链游与 NFT ── */
  AXS: 'Axie Infinity，Play-to-Earn 鼻祖',
  SAND: 'The Sandbox，元宇宙地产 UGC 平台',
  MANA: 'Decentraland，老牌元宇宙',
  IMX: 'Immutable，游戏资产与 NFT 生态，链游 L2',
  GALA: 'Gala Games，链游发行平台',
  BIGTIME: 'Big Time，AAA 级链游，Immutable 生态',
  MAGIC: 'Magic Eden，NFT 聚合市场与游戏平台',
  BLUR: 'Blur，NFT 交易聚合与借贷协议',
  PIXEL: 'Pixels，大规模链游与 NFT 生态',
  AUCTION: 'Auctioneer，NFT 拍卖与创作者工具',
  /* ── 实物资产与 DePIN ── */
  ONDO: 'Ondo Finance，RWA 代币化美债协议',
  GRASS: 'Grass，DePIN 带宽共享，Solana 生态',
  HNT: 'Helium，DePIN 无线网络龙头',
  SYRUP: 'Maple Finance，机构级信用与 RWA 借贷市场',
  POL: 'Polygon，PoS 聚合器，扩容与支付生态',
  RLB: 'Rollercoin，链游与 NFT 平台',
  /* ── 其他加密（隐私 / 稳定币 / 跨链 / 基础设施等未单列的主流币） ── */
  STABLE: 'Stable，跨链稳定币流动性协议',
  USDC: 'USD Coin，Circle 发行合规稳定币',
  STX: 'Stacks，比特币 L2 智能合约',
  ZEC: 'Zcash，隐私币，zk-SNARK',
  XMR: 'Monero，隐私币龙头，环签名',
  DASH: '达世币，老牌隐私支付币',
  ENJ: 'Enjin，Minecraft 与游戏资产发行',
  BAL: 'Balancer，AMM 与流动性池',
  CAKE: 'PancakeSwap，BSC 头部 DEX',
  AXL: 'Axelar，跨链桥与全流动性网络',
  OSMO: 'Osmosis，Cosmos 生态 DEX',
  WGM: 'Wargame，元宇宙链游',
  EDU: 'OpenEden，RWA 与国债型代币',
  SUPER: 'SuperVerse，链游平台',
  AGLD: 'Adventure Gold，链游资产代币',
  RLB: 'Rollercoin，链游平台',
  MAV: 'Maverick Protocol，Solana DEX',
  ORCA: 'Orca，Solana 流动性池',
  RONIN: 'Ronin，Axie 专属侧链',
  MOVR: 'Moonriver，Moonbeam 生态 EVM 链',
  GLMR: 'Moonbeam，跨链互联的 Polkadot 平行链',
  ASTR: 'Astar，跨链基础设施与 EVM 平行链',
  DODO: 'DODO，流动性质押与交易 DEX',
  BIFI: 'BiFi，跨链收益聚合与借贷',
  WBTC: 'Wrapped Bitcoin，锚定比特币的封装资产',
  TBTC: 'tBTC，保留提款权的比特币封装',
  PAXG: 'PAXG，物理黄金支持的代币',
  XAUT: 'Tether Gold，锚定实物黄金的代币',
  MANTA: 'Manta Network，隐私数据 L2 与 ZK 证明',
  SCR: 'Scroll，zk-rollup 以太坊 L2',
  BLAST: 'Blast，Layer 2 与原生收益',
  ZRO: 'LayerZero，跨链消息协议',
  PORTAL: 'Portal，跨链游戏资产互通',
  LAYER: 'Solayer，AI 算力 Layer 2',
  TNSR: 'Tensor，Solana NFT 与游戏基础设施',
  XAI: 'Xai，区块链游戏生态与 AI 算力',
  ZED: 'Zed，隐私向 ZK 邮箱与交易层'
};

/* ---------------- 板块名称（加密生态分类，与 universe.SECTORS 一致） ---------------- */
const SEC_NAME = {
  l1: '公链层', l2: '扩容层', defi: 'DeFi', meme: 'Meme', ai: 'AI',
  infra: '基础设施', nft: '链游与NFT', rwa: '实物资产与DePIN', other: '其他加密'
};
const SEC_ICON = {
  l1: '⛓', l2: '🧱', defi: '🔗', meme: '🐕', ai: '🤖',
  infra: '🧰', nft: '🎮', rwa: '🏗', other: '🪙'
};

function conceptOf(sym, sector, name) {
  if (C[sym]) return C[sym];
  const s = SEC_NAME[sector] || sector;
  return name + '（' + sym + '），' + s + '板块加密资产，OKX USDT 永续合约，7×24 小时交易';
}

/* ---------------- 数据库 ---------------- */
let DB = null;
let ENSURED = 0;
function db() {
  if (DB) return DB;
  try {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    const { DatabaseSync } = require('node:sqlite');
    DB = new DatabaseSync(DB_FILE);
    DB.exec('PRAGMA journal_mode=WAL');
    DB.exec('CREATE TABLE IF NOT EXISTS insts (' +
      'instId TEXT PRIMARY KEY, sym TEXT, name TEXT, sector TEXT, cat TEXT,' +
      ' concept TEXT, tags TEXT, lever TEXT, updated INTEGER)');
    DB.exec('CREATE INDEX IF NOT EXISTS idx_insts_sym ON insts(sym)');
    DB.exec('CREATE INDEX IF NOT EXISTS idx_insts_sector ON insts(sector)');
  } catch (e) { DB = null; }
  return DB;
}

/* 首次/定期：从 kline.instruments() 拉全量合约 → 打分类+概念 → upsert */
async function ensure(force) {
  const d = db(); if (!d) return { ok: false, err: 'no db' };
  if (ENSURED && !force && Date.now() - ENSURED < 10 * 60000) return { ok: true, cached: true };
  try {
    const K = require('./kline');
    const r = await K.instruments();
    const list = (r && r.list) || [];
    if (!list.length) return { ok: false, err: 'no instruments' };
    const U = require('./universe');
    const ups = d.prepare('INSERT INTO insts(instId,sym,name,sector,cat,concept,tags,lever,updated) ' +
      'VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(instId) DO UPDATE SET ' +
      'sym=excluded.sym,name=excluded.name,sector=excluded.sector,' +
      'concept=excluded.concept,tags=excluded.tags,lever=excluded.lever,updated=excluded.updated');
    const now = Date.now();
    let n = 0;
    d.exec('BEGIN');
    try {
      for (const x of list) {
        const sym = x.sym || x.baseCcy || String(x.instId).split('-')[0];
        const sector = x.sector || U.sectorOf(sym);
        const name = (U.NAMES && U.NAMES[sym]) || sym;
        const concept = conceptOf(sym, sector, name);
        const tags = [SEC_NAME[sector] || sector, name, sym].join(' ');
        ups.run(x.instId, sym, name, sector, x.cat || '', concept, tags, x.lever || '', now);
        n++;
      }
      d.exec('COMMIT');
    } catch (e) { try { d.exec('ROLLBACK'); } catch (e2) { } throw e; }
    ENSURED = now;
    return { ok: true, count: n };
  } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
}

/* ---------------- 查询 ---------------- */
function search(opt) {
  const d = db(); if (!d) return { ok: false, list: [] };
  opt = opt || {};
  try {
    let sql = 'SELECT * FROM insts WHERE 1=1';
    const args = [];
    if (opt.sector && opt.sector !== 'all') { sql += ' AND sector=?'; args.push(opt.sector); }
    if (opt.q) {
      sql += ' AND (sym LIKE ? OR name LIKE ? OR instId LIKE ? OR tags LIKE ?)';
      const k = '%' + String(opt.q).toUpperCase() + '%';
      args.push(k, k, k, k);
    }
    sql += ' ORDER BY sector, sym LIMIT ?';
    args.push(Math.min(600, opt.limit || 100));
    const rows = d.prepare(sql).all(...args);
    return { ok: true, list: rows.map(r => ({
      instId: r.instId, sym: r.sym, name: r.name, sector: r.sector,
      cat: r.cat, concept: r.concept, lever: r.lever
    })) };
  } catch (e) { return { ok: false, list: [], err: String(e && e.message || e) }; }
}

function get(sym) {
  const d = db(); if (!d) return null;
  try {
    const r = d.prepare('SELECT * FROM insts WHERE sym=? OR instId=? LIMIT 1').get(sym, sym);
    if (!r) return null;
    return { instId: r.instId, sym: r.sym, name: r.name, sector: r.sector, concept: r.concept, lever: r.lever };
  } catch (e) { return null; }
}

/* 分类树：sector → 合约数（供"各个板块分布"） */
function tree() {
  const d = db(); if (!d) return { ok: false, sectors: [] };
  try {
    const rows = d.prepare('SELECT sector, COUNT(*) c FROM insts GROUP BY sector').all();
    const list = rows.map(r => ({
      id: r.sector, name: SEC_NAME[r.sector] || r.sector,
      icon: SEC_ICON[r.sector] || '', count: r.c, subs: []
    })).sort((a, b) => b.count - a.count);
    return { ok: true, sectors: list };
  } catch (e) { return { ok: false, sectors: [] }; }
}

function stat() {
  const d = db();
  let rows = 0;
  try { if (d) { const a = d.prepare('SELECT COUNT(*) c FROM insts').get(); rows = a ? a.c : 0; } } catch (e) { }
  return { rows, file: DB_FILE, ensuredAt: ENSURED };
}

module.exports = { ensure, search, get, tree, stat, conceptOf, db, SEC_NAME, SEC_ICON };
