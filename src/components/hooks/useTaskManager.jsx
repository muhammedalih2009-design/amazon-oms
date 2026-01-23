import { useState, useEffect, createContext, useContext, useCallback } from 'react';

const TaskManagerContext = createContext(null);

export function TaskManagerProvider({ children }) {
  const [tasks, setTasks] = useState([]);
  const [notificationPermission, setNotificationPermission] = useState('default');

  useEffect(() => {
    // Request notification permission on mount
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  const requestNotificationPermission = async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      return permission;
    }
    return Notification.permission;
  };

  const showNotification = (title, body, taskId) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification(title, {
        body,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: taskId,
        requireInteraction: false
      });

      notification.onclick = () => {
        window.focus();
        // Re-open task modal
        setTasks(prev => prev.map(t => 
          t.id === taskId ? { ...t, modalVisible: true } : t
        ));
        notification.close();
      };
    }
  };

  const createTask = useCallback((taskName, totalItems) => {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newTask = {
      id: taskId,
      name: taskName,
      status: 'running', // running, success, failed, cancelled
      progress: {
        current: 0,
        total: totalItems,
        successCount: 0,
        failCount: 0
      },
      log: [],
      modalVisible: true,
      createdAt: new Date(),
      completedAt: null
    };

    setTasks(prev => [...prev, newTask]);
    return taskId;
  }, []);

  const updateTask = useCallback((taskId, updates) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      
      const updatedTask = { ...task, ...updates };
      
      // Detect completion
      if (task.status === 'running' && 
          (updates.status === 'success' || updates.status === 'failed')) {
        updatedTask.completedAt = new Date();
        
        // Show notification
        const { successCount = 0, failCount = 0 } = updatedTask.progress;
        const title = updates.status === 'success' 
          ? '✅ Task Completed' 
          : '⚠️ Task Completed with Errors';
        const body = `${task.name}: ${successCount} succeeded, ${failCount} failed`;
        
        showNotification(title, body, taskId);
      }
      
      return updatedTask;
    }));
  }, []);

  const minimizeTask = useCallback((taskId) => {
    setTasks(prev => prev.map(task => 
      task.id === taskId ? { ...task, modalVisible: false } : task
    ));
  }, []);

  const showTask = useCallback((taskId) => {
    setTasks(prev => prev.map(task => 
      task.id === taskId ? { ...task, modalVisible: true } : task
    ));
  }, []);

  const removeTask = useCallback((taskId) => {
    setTasks(prev => prev.filter(task => task.id !== taskId));
  }, []);

  const getTask = useCallback((taskId) => {
    return tasks.find(task => task.id === taskId);
  }, [tasks]);

  const activeTasks = tasks.filter(t => t.status === 'running');
  const completedTasks = tasks.filter(t => t.status !== 'running');

  const value = {
    tasks,
    activeTasks,
    completedTasks,
    createTask,
    updateTask,
    minimizeTask,
    showTask,
    removeTask,
    getTask,
    notificationPermission,
    requestNotificationPermission
  };

  return (
    <TaskManagerContext.Provider value={value}>
      {children}
    </TaskManagerContext.Provider>
  );
}

export function useTaskManager() {
  const context = useContext(TaskManagerContext);
  if (!context) {
    throw new Error('useTaskManager must be used within TaskManagerProvider');
  }
  return context;
}