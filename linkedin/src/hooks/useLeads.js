import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import client from "../api/client";

export function useLeads() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchLeads = useCallback(async () => {
    try {
      const res = await client.get("/api/leads");
      setLeads(res.data);
    } catch {
      // silently swallow — backend may be temporarily unreachable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeads();
    const id = setInterval(fetchLeads, 15000);
    return () => clearInterval(id);
  }, [fetchLeads]);

  const queueLead = useCallback(async (leadId) => {
    try {
      await client.post(`/api/leads/${leadId}/queue`);
      setLeads(prev =>
        prev.map(l => l.id === leadId ? { ...l, connect_status: "queued" } : l)
      );
    } catch {
      toast.error("Failed to add to queue");
    }
  }, []);

  return { leads, loading, refetch: fetchLeads, queueLead };
}
