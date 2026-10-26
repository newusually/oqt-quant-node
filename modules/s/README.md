# 🎒 一年级趣味学习乐园（First-Grade Learning Land）

一套专为 **小学一年级（6-7 岁）** 设计的纯前端互动学习网页，覆盖 **口算动画、看图应用、数学测试、语文测试、成长教育、语文学习、薄弱点巩固、拼音专区、写作专区、英语专区、英语测试、教案中心** 等页面；其中「教案中心」进一步结合人教版教材，提供 **一年级 ～ 六年级** 语文 / 数学 / 英语 的单元教案。

全部 **零运行时依赖、离线可用、兼容老内核浏览器**（微信 / QQ / 钉钉 的 X5 内核，Chromium 57–66 及更早版本），双击 HTML 即可运行，也可一键部署到 GitHub Pages。

---

## ✨ 核心特性

- **前台 / 后台分层 + Vue 3 渲染**：HTML 只留 `<div id="app" data-view="xxx">`，全部界面由 Vue 3（本地 vendor 构建）渲染；JS 分「后台数据/服务层」与「前台视图层」，CSS 分 base / components / pages 三层。
- **多 JSON 题库融合**：通过 `题库/manifest.json` 把任意多份真题卷（数学 / 语文 / 应用题）按 `type` 自动合并进对应题库池，与内置随机题库一起使用。
- **变种引擎**：应用题与生成器每次抽题都重新随机，旧题秒变新题；应用题还能同品类互换动植物图片，题目无限变种。
- **知识点（kp）+ 针对性讲解**：每题携带知识点标签与“答错小讲解”，并自动统计**薄弱知识点**，供「薄弱点巩固」页做针对性练习。
- **语音 + 动画**：答题自动语音读题（可一键开关），拼音按中文呼读音朗读、英文按 en-US 朗读，绝不混淆；口算用可爱 SVG 动画演示加减乘除、凑十法与混合运算。
- **开源画图工具箱**：内置 SVG.js / Rough.js（手绘风）/ anime.js（补间动画）/ Vivus（描边动画）/ SortableJS（拖拽排序）/ canvas-confetti（礼花）/ markdown-it，封装为 `App.Guide` 统一接口——画线段（带尺子刻度）、数学图形、田字格 / 四线三格、笔顺描边动画，全部离线可用。
- **JSON 数据层**：所有字典数据来自开源数据集（Unihan 汉字读音、jieba 2万词、chinese-xinhua 3万成语、chinese-poetry 唐诗三百首/蒙学、ECDICT 77万英语词精选 4600），按学科分文件、分类分页，由数据引擎统一调用。
- **整篇朗读**：教案、课文、故事、字母表、单词表都能「按顺序读完」，也可单条点读。
- **离线 SVG 图库**：40+ 动物 / 植物 / 水果 / 日常物品 / 人物图标，全部内联 SVG，不依赖任何图片文件。
- **全浏览器兼容**：无 ES Module、无 `??` / `?.`、无 `gap` / `inset` / `min()·clamp()`、无未加前缀的 `backdrop-filter`；附带 Promise / fetch / 数组 / 字符串 / DOM 垫片与 flex 退化方案。
- **移动端友好**：viewport 适配、大按钮、触摸解锁音频、媒体查询布局。

---

## 📁 目录结构（三层架构）

```
first-grade-learning-land/
├── index.html               # 入口主页（与 主页.html 同名双入口）
├── 主页.html
├── 口算动画课堂.html        # 口算动画课堂
├── 看图学应用.html          # 看图学应用（应用题）
├── 数学测试卷.html          # 数学测试卷
├── 语文测试卷.html          # 语文测试卷
├── 成长小课堂.html          # 霸凌应对 / 人际交往 / 学习方法 / 做人处事
├── 语文学习.html            # 拼音跟读 / 认字 / 组词造句 / 课文 / 知识点
├── 拼音专区.html            # 写法·组成·拼读·形象记忆·四声朗读·组词填字
├── 写作专区.html            # 看图写话·句子仿写·连词成句·量词搭配·标点练习
├── 英语专区.html            # 字母·单词·组词拼写·句子·完形·听力·背诵·记忆妙招
├── 巩固练习.html            # 薄弱点巩固（针对错题练习）
├── 英语测试.html            # 英语测试（选词·听力·拼写·完形填空，真题随机抽）
├── 教案中心.html            # 1-6 年级 人教版 语文/数学/英语 单元教案
├── 数据宝库.html            # 数据宝库：汉字/词语/成语/古诗/蒙学/口诀/英语词典，分类分页查
├── 试卷中心.html            # 试卷中心：1080 套小学试卷（语数英 1-6 年级），在线答题自动批改
├── 题库/                    # 外部真题融合题库
│   ├── manifest.json        # 融合清单（指向各份真题 JSON）
│   ├── 数学真题A.json
│   ├── 数学真题B.json
│   ├── 数学真题C.json
│   ├── 语文真题A.json
│   ├── 语文真题B.json
│   ├── 拼音真题.json
│   ├── 英语真题.json
│   ├── 看图应用题.json
│   ├── 数学拓展.json
│   └── 语文拓展.json
└── assets/
    ├── css/
    │   ├── base/            # 基础层：reset / 布局骨架（顶栏、导航、卡片、页脚）
    │   ├── components/      # 组件层：ui / quiz / abacus / anim / social / learn / shell
    │   ├── pages/           # 页面层：主页 / 拼音专区 / 写作专区 / 英语专区 / 教案
    │   └── compat.css       # 兼容层：老内核降级
    └── js/
        ├── vendor/          # 第三方：vue.global.prod.js / svg.min.js(SVG.js) / rough.js
        │                   #          anime.min.js / vivus.min.js / Sortable.min.js
        │                   #          canvas-confetti.min.js / markdown-it.min.js（全部本地内置）
        ├── core/            # 基础层：compat 兼容 / config 配置+导航 / utils 工具
        │                   #          store 全局状态（星星·徽章·自动朗读开关）
        │                   #          shell 全站外壳 Vue 组件（顶栏/导航/页脚）/ seo 搜索引擎优化
        ├── services/        # 后台层：images 图库 / speech 语音 / banks 题库
        │                   #          content-* 各科内容与生成器 / abacus 口算引擎
        │                   #          nlp 分词注音 / animals 动物叫声 / draw 画图引擎
        │                   #          guide-draw 画图工具箱（封装开源库）/ data-engine 数据引擎
        ├── data/            # 数据层：纯 JSON 数据文件（分学科/分文件/分页）
        │   ├── hanzi.js words.js            # 汉字读音（Unihan 开源数据）/ 2万常用词（jieba）
        │   ├── math/                        # 数学：数字/乘法口诀/单位/图形/钟表/口诀公式
        │   ├── english/                     # 英语：基础词/学校/家庭/自然/词典(ECDICT)/阅读/拼读/方法
        │   ├── chinese/                     # 语文：作文范文库 / 学习方法
        │   ├── dict/                        # 词典：成语(3万)/唐诗三百首/三字经/弟子规/千字文/声律启蒙
        │   └── banks/                       # 注册式真题库（file:// 也能抽）
        ├── views/           # 前台层：每个页面一个 Vue 组件（App.views.xxx）
        └── app.js           # 启动器：读 data-view → createApp → mount
```

**分层加载顺序**（每个 HTML 末尾按依赖顺序引入）：
`vendor/vue → core/compat → core/config → core/utils → core/store → core/shell → services/images → services/speech → services/banks → services/content-*（本页）→ views/本页视图 → app.js`

**页面怎么写**：HTML 只写基础部分，其余全交给 JS：

```html
<div id="app" data-view="abacus"></div>
<script src="assets/js/vendor/vue.global.prod.js"></script>
<!-- core → services → views/abacus-view.js → app.js -->
```

---

## 📚 题库融合与变种

1. 把任意真题卷整理成 JSON，放进 `题库/`，格式：`{ "questions": [ { ... } ] }`。
2. 在 `题库/manifest.json` 里登记文件与 `type`（`math` / `chinese` / `problems` / `pinyin` / `english`）。
3. 系统加载时自动把多份真题合并进题库池；抽题时**真题 + 内置生成器**混合出现。
4. 应用题生成器包含 `add / sub / add2 / sub2 / diff / ord` 等题型；数学含口算、比大小、填空、看图列式、解决问题、找规律、排队、乘除法与混合运算；语文含拼音、笔画、量词、多音字、反义词、课文、阅读、组词、造句、连词成句等。
5. 题型可继续在 `assets/js/services/content-*.js` 中扩展生成器，并在 `manifest.json` 增加真题即可。

> 若 `题库/` 加载失败（例如本地以 `file://` 直接打开），页面会自动回退到**内置随机题库**，功能不受影响。

---

## 🧩 页面一览

| 页面 | 内容 |
| --- | --- |
| 🧮 口算动画课堂 | 加 / 减 / 凑十法 / 乘 / 除 / 混合，SVG 动画 + 语音讲解 + 画图小工具（线段/角/三角形/正方形/长方形/圆） |
| 🍎 看图学应用 | 看图列式解决生活小问题，含难度选择 |
| 📝 数学测试卷 | 口算·比大小·填空·看图列式·解决问题·找规律·排队·乘除混合 |
| 🔤 语文测试卷 | 拼音·笔画·量词·多音字·反义词连线·课文·阅读·组词造句 |
| 🛡️ 成长小课堂 | 霸凌应对·人际交往·学习方法·做人处事（故事 + 自测） |
| 📚 语文学习 | 拼音跟读·认字卡片·组词造句·课文背诵·知识点总结 |
| 🔡 拼音专区 | 写法(四线三格)·组成(声韵调)·拼读·形象记忆·四声朗读·组词填字 |
| ✍️ 写作专区 | 看图写话·句子仿写·连词成句·量词搭配·标点练习·作文范文库·学习方法 |
| 🔡 英语专区 | 字母·单词·组词拼写·句子·完形填空·听力·阅读理解·自然拼读·词典(4600词)·背诵·妙招·学习方法 |
| 🔡 英语测试 | 选词·听力·拼写·完形填空·阅读理解·自然拼读（真题随机抽，记录薄弱点） |
| 📚 数据宝库 | 3799 常用字拼音·2万词语·3万成语·唐诗三百首·三字经/弟子规/千字文/声律启蒙·英语词典·数学口诀，分类分页搜索 |
| 📝 试卷中心 | 1080 套小学试卷：1-6 年级 × 语数英 × 单元/期中/期末/专项/综合/提升/易错/限时，74115 题在线作答自动批改 |
| 📖 教案中心 | 1-6 年级 · 语文/数学/英语（人教版）单元教案，可朗读 |
| 🎯 薄弱点巩固 | 读取历史薄弱知识点，针对性出练习题 |
| 🏠 主页 | 所有入口与每日寄语 |

---

## 🔧 本地运行

直接双击任意 HTML 即可（推荐用浏览器打开 `index.html` / `主页.html`）。
若想体验「真题融合题库」，请用本地静态服务器打开（`file://` 下 `fetch` 可能受限，会自动回退内置题库）：

```bash
# 任选其一
python3 -m http.server 8080
# 或
npx serve .
# 然后访问 http://localhost:8080
```

---

## 🚀 部署到 GitHub Pages

仓库已开启 GitHub Pages（根目录 `index.html`）。直接推送 `main` 分支即可生效：

```bash
git add -A
git commit -m "feat: 一年级学习乐园 三层架构 + 真题融合 + 全浏览器兼容"
git push origin main
```

访问：https://newusually.github.io/first-grade-learning-land/

---

## 🛡️ 兼容性说明

- 已规避老内核不支持的语法与 CSS：`??` / `?.`、ES Module、`gap` / `inset` / `min()` / `clamp()`、未加前缀的 `backdrop-filter`。
- 附带垫片：Promise、fetch→XHR、Array/String/Object 方法、Element.closest/matches。
- `<html>` 在运行时根据能力自动加 `no-flex` / `old-kernel` / `x5` / `mob` 类，`compat.css` 据此降级（关闭重动画、flex 退化为 inline-block）。
- 语音与音效在用户首次触摸 / 点击后解锁（移动端浏览器策略）。

---

> 为一年级小朋友打造 · 边玩边学 · 语音 + 动画 + 随机出题 + 薄弱点追踪
