'use client';

import React, { useEffect, useState } from 'react';
import { useEnterpriseStore } from '../store/enterpriseStore';
import { SaveFile } from '../types/enterprise';

const SaveLoadPanel: React.FC = () => {
  const { 
    saveFiles, 
    resetCount, 
    saveGame, 
    loadGame, 
    resetGame, 
    getSaveFiles 
  } = useEnterpriseStore();
  const [localSaveFiles, setLocalSaveFiles] = useState<SaveFile[]>([]);
  const [isOpen, setIsOpen] = useState(false);

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
    <div className="fixed top-4 right-4 z-50">
      {/* 存档管理按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors shadow-lg"
      >
        存档管理
      </button>

      {/* 存档面板 */}
      {isOpen && (
        <div className="mt-2 bg-white rounded-lg shadow-xl p-4 w-96 max-h-[80vh] overflow-y-auto">
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
