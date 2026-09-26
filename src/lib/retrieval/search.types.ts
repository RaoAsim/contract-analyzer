export type ChunkHit = {
  id: string;
  ord: number;
  start: number;
  end: number;
  tokenCount: number;
  pageStart: number | null;
  pageEnd: number | null;
};

export type QueryPlan = { queries: string[]; sections: string[]; topic: string | null };
