import React, { useState } from 'react';
import { Header } from './ui/components/Header';
import { StatusBar } from './ui/components/StatusBar';
import { DataTableTab } from './ui/tabs/DataTableTab';
import { CoreProcessorTab } from './ui/tabs/CoreProcessorTab';
import { ConfigTab } from './ui/tabs/ConfigTab';
import { OutputTab } from './ui/tabs/OutputTab';
import { CanvasTab } from './ui/tabs/CanvasTab';
import { InputTab } from './ui/tabs/InputTab';
import { AppProvider, useAppContext } from './store/AppContext';
import { useStore } from './store/useStore';

function MainApp() {
  const [activeTab, setActiveTab] = useState('input');
  const [activeStage, setActiveStage] = useState('1');
  const { state, dispatch } = useAppContext();
  const setZustandData = useStore(s => s.setDataTable);

  return (
    <div className="min-h-screen bg-slate-100 font-sans flex flex-col pb-12">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">

        {/* Tab Navigation */}
        <div className="flex space-x-1 border-b border-slate-300 mb-6 flex-wrap gap-y-2">
          <button
            onClick={() => setActiveTab('input')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${activeTab === 'input' ? 'border-blue-600 text-blue-700 bg-white rounded-t' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
          >
            Input PCF
          </button>
          <button
            onClick={() => setActiveTab('data')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${activeTab === 'data' ? 'border-blue-600 text-blue-700 bg-white rounded-t' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
          >
            3DTopo Data Table
          </button>
          <button
            onClick={() => setActiveTab('canvas')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors flex items-center gap-1 ${activeTab === 'canvas' ? 'border-blue-600 text-blue-700 bg-white rounded-t' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
          >
            <span>3D Topography</span>
            <span className="bg-blue-100 text-blue-700 py-0.5 px-1.5 rounded text-[10px] uppercase font-bold">New</span>
          </button>
          <button
            onClick={() => setActiveTab('core')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${activeTab === 'core' ? 'border-blue-600 text-blue-700 bg-white rounded-t' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
          >
            Debug
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${activeTab === 'config' ? 'border-blue-600 text-blue-700 bg-white rounded-t' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
          >
            Config
          </button>
          <button
            onClick={() => setActiveTab('output')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${activeTab === 'output' ? 'border-blue-600 text-blue-700 bg-white rounded-t' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
          >
            Output
          </button>
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded shadow-sm min-h-[500px] border border-slate-200">
          {activeTab === 'input' && <InputTab />}
          {activeTab === 'data' && (
            <div className="flex flex-col">
              <div className="bg-slate-100 p-2 border-b border-slate-200 flex space-x-2">
                 <button onClick={() => setActiveStage('1')} className={`px-3 py-1 text-sm font-medium rounded ${activeStage === '1' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'}`}>Stage 1: Syntax & Base Data</button>
                 <button onClick={() => setActiveStage('2')} className={`px-3 py-1 text-sm font-medium rounded ${activeStage === '2' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'}`}>Stage 2: Topology & Fixing</button>
                 <button onClick={() => setActiveStage('3')} className={`px-3 py-1 text-sm font-medium rounded ${activeStage === '3' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'}`}>Stage 3: Final Checks</button>
              </div>
              <div className="p-2">
                <DataTableTab stage={activeStage} />
              </div>
            </div>
          )}
          {activeTab === 'core' && <div className="p-4"><CoreProcessorTab /></div>}
          {activeTab === 'canvas' && <div className="p-2"><CanvasTab /></div>}
          {activeTab === 'config' && <ConfigTab />}
          {activeTab === 'output' && <OutputTab />}
        </div>
      </main>

      {/* Show status bar everywhere so the mock data button is always accessible */}
      <StatusBar activeTab={activeTab} activeStage={activeStage} />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <MainApp />
    </AppProvider>
  );
}
