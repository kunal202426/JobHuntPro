import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getQuota, getStats, processQueue } from '../api/client';
import toast from 'react-hot-toast';

export const useQuota = () =>
  useQuery({
    queryKey: ['quota'],
    queryFn: getQuota,
    refetchInterval: 12000,
    staleTime: 8000,
    refetchOnWindowFocus: false,
  });

export const useStats = () =>
  useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
    refetchInterval: 12000,
    staleTime: 8000,
    refetchOnWindowFocus: false,
  });

export const useProcessQueue = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: processQueue,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['quota'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      if (data?.message) {
        toast.success(data.message);
        return;
      }
      const drafted = data?.drafted ?? 0;
      const failed = data?.failed ?? 0;
      const msg = failed > 0
        ? `Queue prepared: ${drafted} drafts ready, ${failed} failed`
        : `Queue prepared: ${drafted} drafts ready for review`;
      toast.success(msg);
    },
    onError: (err) => {
      const msg = err?.response?.data?.detail || err.message;
      toast.error(msg);
    },
  });
};
