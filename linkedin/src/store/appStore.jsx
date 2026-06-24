import { createContext, useContext, useState } from "react";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [queueRunning, setQueueRunning] = useState(false);
  return (
    <AppContext.Provider value={{ queueRunning, setQueueRunning }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppStore() {
  return useContext(AppContext);
}
