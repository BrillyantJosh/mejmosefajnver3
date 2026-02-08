import { useState, useEffect, useCallback } from 'react';

export interface AiTaskUpdate {
  taskId: string;
  type: 'updated_answer';
  answer: {
    type: string;
    final_answer: string;
    confidence: number;
    what_i_did: string[];
    what_i_did_not_do: string[];
    next_step: string;
    _debug?: any;
  };
  originalQuestion: string;
}

export function useAiTaskSSE(nostrHexId: string | null) {
  const [updatedAnswers, setUpdatedAnswers] = useState<AiTaskUpdate[]>([]);

  useEffect(() => {
    if (!nostrHexId) return;

    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    const url = `${API_URL}/api/sse/ai-tasks?user=${nostrHexId}`;

    console.log('🧠 Connecting to AI task SSE:', url);
    const es = new EventSource(url);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ai_task_update' && data.answer) {
          console.log('🔄 Received updated AI answer for task:', data.taskId);
          setUpdatedAnswers(prev => [...prev, data as AiTaskUpdate]);
        }
      } catch (err) {
        // Ignore parse errors (keepalive, etc.)
      }
    };

    es.onerror = () => {
      console.warn('🧠 AI task SSE connection error, will auto-reconnect...');
    };

    return () => {
      console.log('🧠 Closing AI task SSE connection');
      es.close();
    };
  }, [nostrHexId]);

  const clearUpdates = useCallback(() => {
    setUpdatedAnswers([]);
  }, []);

  return { updatedAnswers, clearUpdates };
}
