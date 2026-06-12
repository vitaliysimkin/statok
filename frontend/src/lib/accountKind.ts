const KIND_LABEL_KEY: Record<string, string> = {
  broker: 'accounts.kindBroker',
  exchange: 'accounts.kindExchange',
  bank: 'accounts.kindBank',
  wallet: 'accounts.kindWallet',
  other: 'accounts.kindOther',
}

export function kindLabelKey(kind: string): string {
  return KIND_LABEL_KEY[kind] ?? kind
}
