'use client';

import React, { useEffect, useState } from 'react';
import { useEnterpriseStore } from '../store/enterpriseStore';
import { SaveFile } from '../types/enterprise';
import { buildSavePackage, packageFileName, serializePackage } from '../utils/savePackage';

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
    setValidationError
  } = useEnterpriseStore();
  const [localSaveFiles, setLocalSaveFiles] = useState<SaveFile[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  // 指纹走 WebCrypto，导出是异步的：期间禁用按钮，别让人连点产出两份半截文件（规格 §4.2）
  const [exporting, setExporting] = useState(false);

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
      // 下载复用运行控制表导出同一套写法（OperationCenter.tsx:625-633），只有一处不同：
      // JSON 不加 BOM——BOM 会让 JSON.parse 与 python json.loads 直接报错（规格 §4.2）
      const blob = new Blob([serializePackage(pkg)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addOperationLog('导出存档', `存档包：${fileName}`);
    } catch (error) {
      // 失败要说得出原因（重复 id 之类是 buildSavePackage 抛的中文说明），不能只留在控制台
      console.error('Failed to export save package:', error);
      setValidationError(`导出失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setExporting(false);
    }
  };

  // 加载存档
  const handleLoadSave = (saveFile: SaveFile) => {
    loadGame(saveFile);
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
          <div className="flex gap-2 mb-4">
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
            <button
              onClick={handleResetGame}
              className="flex-1 bg-red-600 text-white px-3 py-2 rounded-md hover:bg-red-700 transition-colors"
            >
              重置游戏
            </button>
          </div>

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
