/**
 * A candidate free mint surfaced by a detector.
 * Detectors only report; they never decide to mint.
 */
export interface MintCandidate {
  /** NFT contract address */
  address: string;
  /** Which detector found it, e.g. "new-deploy" | "first-mint" | "watchlist" */
  source: string;
  /** Block the candidate was observed at */
  blockNumber: number;
  /** Free-form evidence for the log / later scoring step */
  evidence?: Record<string, unknown>;
}

export type CandidateHandler = (candidate: MintCandidate) => void | Promise<void>;

/**
 * Detection strategy. Step 2 of the build fills these in - see README.
 * Each detector runs independently and pushes candidates to the same handler.
 */
export interface Detector {
  readonly name: string;
  start(onCandidate: CandidateHandler): Promise<void>;
  stop(): Promise<void>;
}
