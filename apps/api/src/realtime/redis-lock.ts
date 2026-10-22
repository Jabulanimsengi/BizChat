/** Deletes a lock only while the caller still holds it, so an expired lock is never released by its old owner. */
export const RELEASE_IF_HOLDER_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

/** Renews a lease for its current holder or takes it when free; returns 1 when the caller holds it. */
export const ACQUIRE_OR_RENEW_LEASE_SCRIPT = `
local holder = redis.call('GET', KEYS[1])
if holder == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
if not holder then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
end
return 0
`;
