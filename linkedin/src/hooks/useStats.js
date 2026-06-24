import { useState, useEffect, useCallback } from "react";
import client from "../api/client";

export function useStats() {
  const [stats, setStats] = useState(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await client.get("/api/stats/today");
      setStats(res.data);
    } catch {
      // silently swallow
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const id = setInterval(fetchStats, 30000);
    return () => clearInterval(id);
  }, [fetchStats]);

  return { stats, refetch: fetchStats };
}
