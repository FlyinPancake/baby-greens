import { useQuery } from '@tanstack/react-query'
import { meQuery } from './api'

type Grown = { grower_id: string; grower: string }

/** Who started a batch, when it was someone other than the signed-in user. Otherwise null. */
export function useOtherGrower(batch: Grown | null | undefined): string | null {
  const me = useQuery(meQuery)
  return batch && me.data && me.data.id !== batch.grower_id ? batch.grower : null
}
