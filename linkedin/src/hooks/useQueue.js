import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import client from "../api/client";

export function useQueue() {
  const [queue,   setQueue]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const fetchQueue = useCallback(async () => {
    try {
      const [qRes, rRes] = await Promise.all([
        client.get("/api/queue"),
        client.get("/api/queue/run-state"),
      ]);
      setQueue(qRes.data);
      setRunning(rRes.data.running);
    } catch {
      // silently swallow — backend may be temporarily unreachable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
    const id = setInterval(fetchQueue, 10000);
    return () => clearInterval(id);
  }, [fetchQueue]);

  const skipPerson = useCallback(async (id) => {
    try {
      await client.patch(`/api/queue/${id}/status`, { status: "skipped" });
      setQueue(prev => prev.map(p => p.id === id ? { ...p, status: "skipped" } : p));
    } catch {
      toast.error("Failed to skip");
    }
  }, []);

  const retryPerson = useCallback(async (id) => {
    try {
      await client.patch(`/api/queue/${id}/status`, { status: "pending" });
      setQueue(prev => prev.map(p => p.id === id ? { ...p, status: "pending", error_msg: null } : p));
    } catch {
      toast.error("Failed to retry");
    }
  }, []);

  const manualAdd = useCallback(async (name, profileUrl) => {
    try {
      await client.post("/api/queue", { name, profile_url: profileUrl });
      toast.success("Added to queue");
      await fetchQueue();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to add to queue");
    }
  }, [fetchQueue]);

  const startQueue = useCallback(async () => {
    try {
      await client.post("/api/queue/start");
      setRunning(true);
    } catch {
      toast.error("Failed to start queue");
    }
  }, []);

  const stopQueue = useCallback(async () => {
    try {
      await client.post("/api/queue/stop");
      setRunning(false);
    } catch {
      toast.error("Failed to pause queue");
    }
  }, []);

  return { queue, loading, running, fetchQueue, skipPerson, retryPerson, manualAdd, startQueue, stopQueue };
}
