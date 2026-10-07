'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useEnterpriseStore } from '../store/enterpriseStore';
import { SaveFile, SavePackage } from '../types/enterprise';
import { auditReportFileName, buildSavePackage, packageFileName, parseSavePackage, serializePackage } from '../utils/savePackage';
// 文案表与判据同源（Task 3 的 audit.ts）：UI 只照抄，绝不再自行读 SaveFile.version 推断
// （一条规则写两处就是版本漂移的起点，见 audit.ts 里 FrameAudit.restatementCaliber 的说明）
// Task 8 起，「读数→印面」住在 utils/format.ts、「一帧结论的一行」住在 audit.ts：
// 核对报告（audit.ts）要用同一份措辞，而 util 不能反向 import 组件（设计问题 2）
import {
  auditFrames, auditSummary, buildAuditReport, byTimeThenId, caliberNotesOf, firstDivergingFrame,
  formatFrameAudit, INTEGRITY_BOUNDARY, packageResetCount, packageResetCountText,
} from '../utils/audit';
import type { FrameAudit } from '../utils/audit';
import { money, moneySum } from '../utils/format';
import { digestFrame } from '../utils/saveDigest';

// ══ 印面（导出给 tests/saveImport.test.ts：本仓库测试环境是 node、无 jsdom，规格 §7）═══════
// 这里只留**指纹**那两条——它们是 S-T7 预览独有的读法；金额与一帧结论的措辞已搬到
// utils/format.ts 与 audit.ts（理由见上面那几行注释）。

/** 「可比对的指纹」只认 sha256: 前缀（Task 4 的返回契约：另一支恒为 `unavailable:<原因>`）。
 *  包内声明与本侧重算出来的都要过一次：换设备 / 非 HTTPS 导入时本机没有 crypto.subtle，
 *  算出来是 `unavailable:*`，拿它去比包里的 `sha256:` 必然不等——印出来就是「指纹不一致」这条**假**篡改证。
 *  那种情形只能说「本机算不出」，归入「未计算」那一档（规格 §4.4「无 crypto.subtle → 重演算照常执行」）。 */
export const isComparableDigest = (value: string | undefined): boolean =>
  typeof value === 'string' && value.indexOf('sha256:') === 0;

/** 包内指纹声明无法比对时的一行说明；返回 null 表示「声明是 sha256:，可以比值」，由调用方去重算。
 *  按 **前缀** 分派（Task 4 实况）：`unavailable:` 后面除了 insecure-context 还可能是摘要调用自身
 *  失败带出的 bad-digest / 某个 error name，不能只认那一种。空串/缺字段一律算「未计算」，绝不参与比对。
 *  措辞按规格 §4.4 说人话（不把内部 token 原样印给老师），但仍不猜原因。 */
export const digestSkipNote = (saveName: string, declared: string | undefined): string | null => {
  // 非字符串一律按"包内无可用声明"处理：`digests.frames` 是外部文件的对象，原型链上的
  // toString/constructor 之类如果被当值读出来，下一行 declared.replace 会抛 TypeError，
  // 预览就会印成「读取失败」而不是契约里的「哈希未计算（包内无记录）」（评审 Task 7 finding 1）。
  if (typeof declared === 'string' && isComparableDigest(declared)) return null;
  if (declared === 'unavailable:insecure-context') return `${saveName}：哈希未计算（非 HTTPS 环境）`;
  const reason = typeof declared === 'string' && declared ? declared.replace('unavailable:', '') : '';
  return `${saveName}：哈希未计算${reason ? `（${reason}）` : '（包内无记录）'}`;
};

// 下载：Blob → createObjectURL → appendChild → click → removeChild → revokeObjectURL
// （仓库既有写法，见 OperationCenter.tsx:471-485 的日志导出与 :625-633 的控制表导出）。
// 三处产物共用这一条：存档包 .json、核对报告 .txt / .json。
// BOM 只有 CSV 加（Windows Excel 认中文，OperationCenter.tsx:625），这里两类产物都**不加**——
// BOM 会让 JSON.parse 与 python json.loads 当场报错（规格 §4.2），.txt 加了也会在 diff 里多一个隐形字符。
const downloadFile = (fileName: string, content: string, mime: string): void => {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// 预览结论（此刻**尚未改动存档与当前屏**，规格 §4.3 第 4 步；唯一的 store 写是 validationError 那条消息字段）
interface ImportPreview {
  pkg: SavePackage;
  // 逐帧结论的**原始数据**（Task 8 起）：报告要的是它本身，而不是 mismatches 那几行已印好的文案
  results: FrameAudit[];
  summary: ReturnType<typeof auditSummary>;
  mismatches: string[];
  digestMismatch: string[];
  digestSkipped: string[];
  diverging: FrameAudit | null;
  caliberNotes: string[];
  spanText: string;
  resetCountText: string;
  // 「设为当前进度」要落的那个计数，与 resetCountText 同一个来源、同一道有限性守卫（不传则本机计数不动）
  resetCountValue: number | null;
}

const SaveLoadPanel: React.FC = () => {
  const { 
    state,
    saveFiles, 
    resetCount, 
    saveGame, 
    loadGame, 
    resetGame, 
    getSaveFiles,
    addOperationLog,
    setValidationError,
    importSaveFiles,
    applyImportedState
  } = useEnterpriseStore();
  const [localSaveFiles, setLocalSaveFiles] = useState<SaveFile[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  // 指纹走 WebCrypto，导出是异步的：期间禁用按钮，别让人连点产出两份半截文件（规格 §4.2）
  const [exporting, setExporting] = useState(false);
  const [pending, setPending] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  // 暂停期间两个写动作禁用（规格 §7.10：导出/读文件/预览是只读，照常可用）
  const isPaused = state.isPaused;

  // 加载本地存档
  useEffect(() => {
    const files = getSaveFiles();
    setLocalSaveFiles(files);
  }, [saveFiles, getSaveFiles]);

  // 手动保存
  const handleManualSave = () => {
    saveGame();
    // 重新加载存档列表
    setLocalSaveFiles(getSaveFiles());
  };

  // 导出存档包：只读动作，暂停态照常可用（规格 §7.10）——它只下载文件，不碰任何状态
  const handleExport = async () => {
    setExporting(true);
    try {
      const pkg = await buildSavePackage(state, getSaveFiles());
      const fileName = packageFileName(pkg.app.year, pkg.app.quarter);
      downloadFile(fileName, serializePackage(pkg), 'application/json');
      addOperationLog('导出存档', `存档包：${fileName}`);
    } catch (error) {
      // 失败要说得出原因（重复 id 之类是 buildSavePackage 抛的中文说明），不能只留在控制台
      console.error('Failed to export save package:', error);
      setValidationError(`导出失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setExporting(false);
    }
  };

  // 导入存档包：读文件 + 校验 + 逐帧重演算 + 指纹比值。落库必须由用户在预览上明确点其中一个动作；
  // 这一路径上唯一的 store 写是 validationError 那条**消息字段**（清掉上一次的提示），
  // 存档列表、当前屏、本地存储在预览阶段一律不动（规格 §4.3）。
  const handleFilePicked = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setPending(null);
    setValidationError(null);
    try {
      const parsed = await parseSavePackage(await file.text());
      if (!parsed.ok) { setValidationError(parsed.reason); return; }
      const pkg = parsed.pkg;
      // 包内一帧历史快照都没有时（重置后立刻导出）给当前屏造一个合成帧，只为让审计与指纹有对象可跑；
      // version 必须取 pkg.app.saveVersion，否则口径判定（CALIBER_TEXT 那一档）会印错（Task 7 决定 #1）。
      // 重复 id 不会走到这里：parseSavePackage 的 seenFrameIds 已先拒掉整包（规格 §4.3）。
      const frames: SaveFile[] = pkg.saves.length > 0 ? pkg.saves : [{
        id: 'current', name: '当前进度', enterpriseName: '企业1', timestamp: Date.now(),
        resetCount: 0, version: pkg.app.saveVersion, state: pkg.current, createdAt: pkg.exportedAt,
      }];
      // auditFrames 自带「按 timestamp 升序、同毫秒按 id 兜底」的全序，这里不再重排、也不改 pkg.saves
      const results = auditFrames(frames);
      const mismatches = results.filter((r) => r.status !== 'ok').map(formatFrameAudit);
      // 包内定位：第一处不平的帧才是「分歧起点」，其余帧的不平是它的下游后果（Task 3 定的判据）
      const diverging = firstDivergingFrame(results);
      const digestMismatch: string[] = [];
      const digestSkipped: string[] = [];
      for (const save of frames) {
        // 只读**自有**键：`digests.frames` 来自 JSON.parse，`__proto__` 是自有数据属性，但 id 为
        // constructor/toString/hasOwnProperty 这类原型链上的名字时，点号读出来是 Object.prototype 或函数，
        // 于是 declared.replace(...) 抛 TypeError，预览会印成「读取失败」而不是契约要求的「哈希未计算（包内无记录）」。
        // 与 Task 6 在 savePackage.ts 用 Set 挡同一类危害是同一条道理（评审 Task 7 finding 1）。
        const declared = Object.prototype.hasOwnProperty.call(pkg.digests.frames, save.id)
          ? pkg.digests.frames[save.id]
          : undefined;
        const skipNote = digestSkipNote(save.name, declared);
        if (skipNote) { digestSkipped.push(skipNote); continue; }
        // digestFrame 对**没经过解析器**的帧会同步抛（参数求值就在 digestText 之前），Task 6 的结构
        // 校验是第一道闸，这里再兜一层：指纹算不出来只能记成「未计算」，不能把预览打挂、更不能印成「不一致」。
        try {
          const recomputed = await digestFrame(save);
          if (!isComparableDigest(recomputed)) {
            digestSkipped.push(`${save.name}：哈希无法比对（本机算不出摘要：${recomputed.replace('unavailable:', '')}）`);
          } else if (recomputed !== declared) {
            digestMismatch.push(`${save.name} 的指纹与包内记录不一致`);
          }
        } catch {
          digestSkipped.push(`${save.name}：哈希无法计算（帧结构异常）`);
        }
      }
      // 口径清单：抑制规则与报告同一条（audit.ts 的 caliberNotesOf / frameCaliberNote），两处不能一个说一个不说
      const caliberNotes = caliberNotesOf(results);
      // 时间跨度取 createdAt（规格 §4.3），按 timestamp 定最早/最新、同毫秒按 id 兜底：
      // 兜底用的就是 audit.ts 那份全序比较器（`a.id < b.id` 与 localeCompare 对大小写与 `_` 的排序不同，
      // 实测 56 对 id 里 20 对不一致），只在两帧同毫秒时可观察，但那决定了 span 与重置次数取哪一帧（评审 Task 7 finding 5）。
      let earliest = frames[0];
      let latest = frames[0];
      for (const save of frames) {
        if (byTimeThenId(save, earliest) < 0) earliest = save;
        if (byTimeThenId(save, latest) > 0) latest = save;
      }
      const spanText = pkg.saves.length > 0
        ? `${earliest.createdAt} → ${latest.createdAt}`
        : '包内无历史帧（仅当前屏）';
      // 重置次数是 **SaveFile** 的字段、不在 current 里，只能取最近那一帧的；没有历史帧就给「—」而不是 0。
      // 这条规则（同一个 latest、同一道 Number.isFinite 判据）现在住在 audit.ts，报告与预览共用（Task 8）。
      const resetCountText = packageResetCountText(pkg);
      const resetCountValue = packageResetCount(pkg);
      setPending({
        pkg, results, summary: auditSummary(results), mismatches, digestMismatch, digestSkipped,
        diverging, caliberNotes, spanText, resetCountText, resetCountValue,
      });
    } catch (error) {
      // parseSavePackage 自己不抛（规格 §4.3），这一层兜的是 file.text() 读失败（文件被移走/权限）
      console.error('Failed to preview save package:', error);
      setValidationError(`读取失败：${error instanceof Error ? `${error.name}: ${error.message}` : '未知错误'}`);
    } finally {
      setBusy(false);
      // 清空 input：否则选同一个文件第二次不会触发 change（冒烟里「连导两次」那条就断在这儿）
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  // 动作一：仅加入存档列表（默认，当前屏不变）
  const handleImportToList = () => {
    if (!pending) return;
    // 返回的 {added, renamed} 不在这里印：写成功的话面板随即关闭、列表当场可见，
    // 写失败的话 store 已把原因放进 validationError（同一处不会既报成功又报失败），
    // 逐帧数目由「导入存档」那条操作日志说（评审 Task 7 finding 6，取舍记在此免得下次又当遗漏）
    importSaveFiles(pending.pkg.saves);
    setValidationError(null);
    setPending(null);
    setIsOpen(false);
    setLocalSaveFiles(getSaveFiles());
  };

  // 动作二：设为当前进度（不自动并入列表，规格 §4.3）
  const handleApplyToCurrent = () => {
    if (!pending) return;
    applyImportedState(pending.pkg.current, pending.pkg.app.saveVersion, pending.resetCountValue ?? undefined);
    setValidationError(null);
    setPending(null);
    setIsOpen(false);
  };

  // 导出核对报告（规格 §4.5）：两个按钮、**同一份数据源**——逐帧结论用 pending.results（预览当场算的那份），
  // 指纹判定用 pending.digestMismatch / digestSkipped（S-T7 的异步哈希循环刚算完的两张表）。
  // 报告自己不再算一次指纹：它是同步函数，而重算需要 WebCrypto，且会变成同一件事的第二套实现
  // （Task 8 设计问题 1）。也因此这里没有 exporting 那样的异步态。
  // 只读动作：不受 isPaused 禁用（规格 §7 第 10 条）。也**不写操作日志**——存档包导出写日志是因为它
  // 是"一次交付动作"，而报告要在核对过程中反复点；addOperationLog 会改当前屏的日志，
  // 让「同一份包再核对一次」时的本机状态与刚点开预览时不一致，核对动作应当不留痕。
  const handleExportReport = (ext: 'txt' | 'json') => {
    if (!pending) return;
    const { json, text } = buildAuditReport(pending.pkg, pending.results, INTEGRITY_BOUNDARY, {
      mismatch: pending.digestMismatch,
      skipped: pending.digestSkipped,
    });
    // 文件名与存档包同一条规则（年季 + 到分钟的时间戳），只把用途换成「核对报告」（§4.5 的「文件名」）
    const fileName = auditReportFileName(pending.pkg.app.year, pending.pkg.app.quarter, ext);
    downloadFile(fileName, ext === 'json' ? json : text, ext === 'json' ? 'application/json' : 'text/plain');
  };

  // 加载存档
  const handleLoadSave = (saveFile: SaveFile) => {    loadGame(saveFile);
    setIsOpen(false);
  };

  // 重置游戏
  const handleResetGame = () => {
    if (window.confirm('确定要重置游戏吗？所有当前进度将丢失！')) {
      resetGame();
      setIsOpen(false);
    }
  };

  // 删除存档
  const handleDeleteSave = (saveId: string) => {
    if (window.confirm('确定要删除这个存档吗？')) {
      const updatedFiles = localSaveFiles.filter(file => file.id !== saveId);
      localStorage.setItem('enterpriseSaveFiles', JSON.stringify(updatedFiles));
      setLocalSaveFiles(updatedFiles);
    }
  };

  return (
    <div className="relative z-50">
      {/* 存档管理按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors shadow-lg"
      >
        存档管理
      </button>

      {/* 存档面板 */}
      {isOpen && (
        <div className="absolute right-0 mt-2 bg-white rounded-lg shadow-xl p-4 w-96 max-h-[80vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">存档管理</h3>
            <div className="text-sm text-gray-500">
              重置次数: {resetCount}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={handleManualSave}
              className="flex-1 bg-green-600 text-white px-3 py-2 rounded-md hover:bg-green-700 transition-colors"
            >
              手动存档
            </button>
            {/* 导出放在两个安全动作之间，重置游戏仍留在最右——破坏性按钮不夹在中间 */}
            <button
              onClick={handleExport}
              disabled={exporting}
              title="下载含全部历史快照与指纹的 JSON 文件，可在其它浏览器导入"
              className="flex-1 bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700 transition-colors disabled:bg-blue-300 disabled:cursor-not-allowed"
            >
              {exporting ? '导出中…' : '导出存档包'}
            </button>
            {/* 导入入口与导出并列：两者都是「读/写文件」，都不碰当前屏（落库在预览里再选） */}
            <input
              ref={fileInput}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => handleFilePicked(e.target.files?.[0])}
            />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              title="选择存档包 JSON 文件，先出预览再决定怎么落库；暂停态也可用（只读）"
              className="flex-1 bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700 transition-colors disabled:bg-blue-300 disabled:cursor-not-allowed"
            >
              {busy ? '核对中…' : '导入存档包'}
            </button>
            <button
              onClick={handleResetGame}
              className="flex-1 bg-red-600 text-white px-3 py-2 rounded-md hover:bg-red-700 transition-colors"
            >
              重置游戏
            </button>
          </div>

          {/* 导入预览：此时**未改动任何状态**，两条落库路径都要由人明确点一下才生效（规格 §4.3 第 4 步） */}
          {pending && (
            <div className="mb-4 border border-gray-300 rounded-md p-3 bg-gray-50 space-y-2">
              <div className="flex justify-between items-center">
                <h4 className="text-md font-medium">导入预览</h4>
                <span className="text-xs text-gray-500">{pending.summary.total} 帧 / {pending.spanText}</span>
              </div>
              <div className="text-xs text-gray-600">导出时间：{pending.pkg.exportedAt}</div>

              {/* 当前屏读数（规格 §4.3：年季 / 现金 / 应收合计 / 长短期贷款本金合计 / 重置次数） */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <div className="text-gray-500">当前帧</div>
                <div>第{pending.pkg.current.operation.currentYear}年第{pending.pkg.current.operation.currentQuarter}季</div>
                <div className="text-gray-500">现金</div>
                <div>{money(pending.pkg.current.finance.cash)}</div>
                <div className="text-gray-500">应收合计</div>
                <div>{moneySum(pending.pkg.current.finance.accountsReceivable ?? [])}</div>
                <div className="text-gray-500">贷款本金合计</div>
                <div>{moneySum((pending.pkg.current.finance.loans ?? []).map((l) => l?.principal))}</div>
                <div className="text-gray-500">重置次数</div>
                <div>{pending.resetCountText}</div>
              </div>

              <div className="text-sm">
                完整性：共 {pending.summary.total} 帧，通过 {pending.summary.ok}，
                账实不符 {pending.summary.mismatch}（其中旧档 {pending.summary.legacyMismatch}），
                起算链不完整 {pending.summary.noAnchor}
              </div>

              {/* 「非覆盖」只保住了存档列表的字节，保不住派生的控制表：控制表按 (年,季) 取最大 timestamp
                  选帧，一份 wall-clock 更晚的外来帧会静接管同 (年,季) 的格子（评审 Task 7 finding 3）。
                  所以这里必须把话说在前面，并给被追加改名的那一帧标上「（导入N）」。 */}
              <div className="text-xs text-gray-500">
                导入的历史帧会参与运行控制表与统计取数；与本机同 id 的帧会改名为「-imported-N」并加标注，原有存档不变。
              </div>

              {/* 红字都是**提示**，不阻断导入（规格 §4.4：客户端做不到强防篡改，结论给人看不是拿来拦人） */}
              {pending.mismatches.length > 0 && (
                <div className="text-red-700 text-xs space-y-1">
                  {/* key 用下标而不是文案：帧名精确到秒、同一秒内的两帧会给出一模一样的行，
                      按内容当 key 就撞成重复 key（React 警告 + 复用错行） */}
                  {pending.mismatches.map((line, i) => <div key={`mm-${i}`}>账实核对：{line}</div>)}
                </div>
              )}
              {pending.digestMismatch.length > 0 && (
                <div className="text-red-700 text-xs space-y-1">
                  {pending.digestMismatch.map((line, i) => <div key={`dm-${i}`}>指纹核对：{line}</div>)}
                </div>
              )}
              {/* 非安全上下文必须显式说明「哈希未计算」，绝不静默跳过（规格 §4.4） */}
              {pending.digestSkipped.length > 0 && (
                <div className="text-gray-500 text-xs space-y-1">
                  {pending.digestSkipped.map((line, i) => <div key={`ds-${i}`}>{line}</div>)}
                </div>
              )}
              <div className="text-sm">
                {pending.diverging
                  ? `分歧始于：${pending.diverging.saveName}（第${pending.diverging.year}年第${pending.diverging.quarter}季）`
                  : '未发现账实分歧'}
              </div>
              {pending.caliberNotes.length > 0 && (
                <div className="text-gray-500 text-xs space-y-1">
                  {pending.caliberNotes.map((note, i) => <div key={`cn-${i}`}>{note}</div>)}
                </div>
              )}
              {pending.pkg.saves.length === 0 && (
                <div className="text-gray-500 text-xs">包内无历史帧：「仅加入存档列表」不会新增条目，请用「设为当前进度」。</div>
              )}

              {/* 暂停态的可见说明（规格 §7.10 定死：只读动作照常可用，两个写动作禁用） */}
              {isPaused && (
                <div className="text-amber-700 text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  运营已暂停，请先继续运营再导入（导出与预览仍可用）
                </div>
              )}

              {/* 核对报告（规格 §4.5）：两份产物、同一数据源（pending.results + 两张指纹表）。
                  只读动作，暂停态**照常可用**（§7 第 10 条），所以这里不挂 disabled={isPaused}——
                  与下面两个落库动作的取舍正好相反，面板上方那条琥珀色提示说的就是这层区分。 */}
              <div className="flex gap-2">
                <button
                  onClick={() => handleExportReport('txt')}
                  title="下载纯文本核对报告：首行是能力边界声明，随后是逐帧结论与指纹判定"
                  className="flex-1 bg-white border border-gray-400 text-gray-800 px-3 py-2 rounded-md text-sm hover:bg-gray-100 transition-colors"
                >
                  导出核对报告（txt）
                </button>
                <button
                  onClick={() => handleExportReport('json')}
                  title="下载 JSON 核对报告：同一份数据的机读版，脚本可直接读 frames、summary 与两张指纹表"
                  className="flex-1 bg-white border border-gray-400 text-gray-800 px-3 py-2 rounded-md text-sm hover:bg-gray-100 transition-colors"
                >
                  导出核对报告（json）
                </button>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleImportToList}
                  disabled={isPaused}
                  title={isPaused ? '运营已暂停，请先继续运营再导入' : '同 id 冲突时改名追加，原有存档不变'}
                  className="flex-1 bg-blue-600 text-white px-3 py-2 rounded-md text-sm hover:bg-blue-700 transition-colors disabled:bg-blue-300 disabled:cursor-not-allowed"
                >
                  仅加入存档列表
                </button>
                <button
                  onClick={handleApplyToCurrent}
                  disabled={isPaused}
                  title={isPaused ? '运营已暂停，请先继续运营再导入' : '只替换当前屏，不自动写入存档列表'}
                  className="flex-1 bg-indigo-600 text-white px-3 py-2 rounded-md text-sm hover:bg-indigo-700 transition-colors disabled:bg-blue-300 disabled:cursor-not-allowed"
                >
                  设为当前进度
                </button>
                <button
                  onClick={() => setPending(null)}
                  className="flex-1 bg-gray-200 text-gray-800 px-3 py-2 rounded-md text-sm hover:bg-gray-300 transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {/* 存档列表 */}
          <div className="space-y-3">
            <h4 className="text-md font-medium">存档列表</h4>
            {localSaveFiles.length === 0 ? (
              <div className="text-center text-gray-500 py-4">
                暂无存档
              </div>
            ) : (
              localSaveFiles.map((saveFile) => (
                <div 
                  key={saveFile.id} 
                  className="border border-gray-200 rounded-md p-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium truncate">{saveFile.name}</div>
                      <div className="text-sm text-gray-500 mt-1">
                        创建时间: {saveFile.createdAt}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {saveFile.state.operation.currentYear}年{saveFile.state.operation.currentQuarter}季度
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleLoadSave(saveFile)}
                        className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors"
                      >
                        加载
                      </button>
                      <button
                        onClick={() => handleDeleteSave(saveFile.id)}
                        className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 transition-colors"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SaveLoadPanel;
