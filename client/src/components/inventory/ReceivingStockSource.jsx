import { receivingStockSource } from './receiving-stock-source.mjs';

export function ReceivingStockSource({ item }) {
  const source = receivingStockSource(item);
  if (!source) return null;
  return <a href={source.href} className="inline-flex min-h-[48px] items-center text-sm text-blue-700 underline break-words">{source.label}</a>;
}
