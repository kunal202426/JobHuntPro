import { useQuery } from '@tanstack/react-query';
import { getLinkedInLeads } from '../api/linkedinClient';

export function useProspects() {
  return useQuery({
    queryKey: ['prospects'],
    queryFn: () => getLinkedInLeads(),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    staleTime: 0,
    retry: 1,
    throwOnError: false,
  });
}
