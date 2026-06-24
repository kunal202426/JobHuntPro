import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import client from "../api/client";

export function useJobs() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await client.get("/api/jobs");
      setJobs(res.data);
      setError(null);
    } catch (err) {
      setError(!err.response ? "backend_offline" : err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    const doFetch = async () => {
      try {
        const res = await client.get("/api/jobs");
        if (active) { setJobs(res.data); setError(null); }
      } catch (err) {
        if (active) setError(!err.response ? "backend_offline" : err.message);
      } finally {
        if (active) setLoading(false);
      }
    };

    doFetch();
    const id = setInterval(doFetch, 15000);
    return () => { active = false; clearInterval(id); };
  }, []);

  const updateStatus = useCallback(async (jobId, status) => {
    try {
      await client.patch(`/api/jobs/${jobId}/status`, { status });
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status } : j));
    } catch {
      toast.error("Failed to update status");
    }
  }, []);

  const dismissJob = useCallback(async (jobId) => {
    try {
      await client.patch(`/api/jobs/${jobId}/status`, { status: "dismissed" });
      setJobs(prev => prev.filter(j => j.id !== jobId));
    } catch {
      toast.error("Failed to dismiss job");
    }
  }, []);

  return { jobs, loading, error, refetch: fetchJobs, updateStatus, dismissJob };
}
