import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getLeads, addLead, deleteLead, updateLeadStatus, approveDraft, checkDuplicate, csvPreview, bulkSubmit, generatePreview } from '../api/client';
import toast from 'react-hot-toast';

export const useLeads = (filters = {}) =>
  useQuery({
    queryKey: ['leads', filters],
    queryFn: () => getLeads(filters),
    refetchInterval: 8000,
    staleTime: 5000,
    refetchOnWindowFocus: false,
  });

export const useAddLead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addLead,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['quota'] });
      if (data.status === 'draft') toast.success(`📝 Draft saved for ${data.hr_name} — approve to send`);
      else if (data.status === 'sent') toast.success(`✅ Email sent to ${data.hr_name}!`);
      else if (data.status === 'pending') toast(`⏳ Sending in background for ${data.hr_name}`, { icon: '🟡' });
      else if (data.status === 'queued') toast(`📋 Quota full — queued for ${data.hr_name}`, { icon: '🔵' });
      else toast.error(`❌ Failed for ${data.hr_name}`);
    },
    onError: (err) => {
      const msg = err?.response?.data?.detail || err.message;
      toast.error(msg);
    },
  });
};

export const useDeleteLead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteLead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      toast.success('Lead deleted');
    },
  });
};

export const useUpdateStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }) => updateLeadStatus(id, status),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['leads'] });
      const snapshots = qc.getQueriesData({ queryKey: ['leads'] });
      qc.setQueriesData({ queryKey: ['leads'] }, (old) =>
        Array.isArray(old) ? old.map((l) => l.id === id ? { ...l, status } : l) : old
      );
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots?.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error('Failed to update status');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['leads'] }),
    onSuccess: () => toast.success('Status updated'),
  });
};

export const useApproveDraft = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => approveDraft(id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['quota'] });
      qc.invalidateQueries({ queryKey: ['draft-leads'] });
      const message = data?.message
        ? data.message
        : `✅ Approved and sending to ${data.hr_name}`;
      toast.success(message);
    },
    onError: (err) => {
      const msg = err?.response?.data?.detail || err.message;
      toast.error(msg);
    },
  });
};

export const useCheckDuplicate = () =>
  useMutation({ mutationFn: checkDuplicate });

export const useGeneratePreview = () =>
  useMutation({ mutationFn: generatePreview });

export const useCsvPreview = () =>
  useMutation({ mutationFn: csvPreview });

export const useBulkSubmit = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: bulkSubmit,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['quota'] });
      const msg = data.skipped > 0
        ? `⚡ ${data.created} leads queued — ${data.skipped} duplicates skipped`
        : `⚡ ${data.created} leads queued for generation`;
      toast.success(msg);
    },
    onError: (err) => {
      toast.error(err?.response?.data?.detail || 'Bulk submit failed');
    },
  });
};
