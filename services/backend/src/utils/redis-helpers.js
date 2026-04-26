// Safe cache invalidation using SCAN instead of KEYS.
// KEYS is O(N) and blocks the Redis event loop — dangerous at scale.
const scanAndDelete = async (client, pattern) => {
  let cursor = 0;
  do {
    const result = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
    cursor = result.cursor;
    if (result.keys.length > 0) {
      await client.del(result.keys);
    }
  } while (cursor !== 0);
};

module.exports = { scanAndDelete };
