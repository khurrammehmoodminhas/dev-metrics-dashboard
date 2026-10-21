export async function mapInBatches(items, concurrency, mapper) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Concurrency must be a positive integer.');
  }

  const results = [];
  for (let start = 0; start < items.length; start += concurrency) {
    const batch = items.slice(start, start + concurrency);
    const settled = await Promise.allSettled(batch.map((item, index) => mapper(item, start + index)));
    const failed = settled.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
    results.push(...settled.map((result) => result.value));
  }
  return results;
}
