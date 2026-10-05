// Hand-written until milestone 4 replaces this with a client generated from the OpenAPI spec.

export type Health = { database: boolean }

export async function getHealth(): Promise<Health> {
  const response = await fetch('/api/health')
  if (!response.ok && response.status !== 503) {
    throw new Error(`health check failed with status ${response.status}`)
  }
  return response.json()
}
