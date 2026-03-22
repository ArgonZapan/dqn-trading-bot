import { create } from 'zustand';

const useAppStore = create((set) => ({
  // Prices
  prices: { btc: 0, eth: 0, sol: 0 },
  setPrices: (prices) => set({ prices }),

  // Training
  trainingActive: false,
  setTrainingActive: (active) => set({ trainingActive: active }),

  // Paper Trading
  paperActive: false,
  paperStrategy: 'trend',
  setPaperActive: (active) => set({ paperActive: active }),
  setPaperStrategy: (strategy) => set({ paperStrategy: strategy }),

  // UI
  theme: localStorage.getItem('theme') || 'dark',
  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    set({ theme });
  },

  // Notifications
  notifications: [],
  addNotification: (msg, type = 'info') => set((s) => ({
    notifications: [...s.notifications, { id: Date.now(), msg, type }],
  })),
  removeNotification: (id) => set((s) => ({
    notifications: s.notifications.filter((n) => n.id !== id),
  })),
}));

export default useAppStore;
