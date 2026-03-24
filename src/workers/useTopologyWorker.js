/**
 * useTopologyWorker
 *
 * React hook that manages a PcfTopologyGraph2 Web Worker instance.
 * The worker is created once and terminated when the component unmounts.
 *
 * Usage:
 *   const { runTopology, isRunning } = useTopologyWorker({ onComplete, onError, onProgress });
 *   runTopology(rows, config, currentPass);
 */
import { useRef, useState, useEffect, useCallback } from 'react';

export function useTopologyWorker({ onComplete, onError, onProgress } = {}) {
  const workerRef = useRef(null);
  const [isRunning, setIsRunning] = useState(false);

  // Lazily create the worker
  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('./topologyWorker.js', import.meta.url),
        { type: 'module' }
      );
    }
    return workerRef.current;
  }, []);

  useEffect(() => {
    return () => {
      // Terminate worker on unmount to free resources
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  const runTopology = useCallback((rows, config, currentPass) => {
    if (isRunning) return;
    setIsRunning(true);

    const worker = getWorker();

    worker.onmessage = (e) => {
      const { type, proposals, logs, message } = e.data;

      if (type === 'TOPOLOGY_PROGRESS') {
        onProgress?.(message);
      } else if (type === 'TOPOLOGY_COMPLETE') {
        setIsRunning(false);
        onComplete?.({ proposals, logs });
      } else if (type === 'TOPOLOGY_ERROR') {
        setIsRunning(false);
        onError?.(message);
      }
    };

    worker.onerror = (err) => {
      setIsRunning(false);
      onError?.(err.message || 'Worker error');
    };

    worker.postMessage({ type: 'RUN_TOPOLOGY', rows, config, currentPass });
  }, [isRunning, getWorker, onComplete, onError, onProgress]);

  return { runTopology, isRunning };
}
