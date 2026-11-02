const TRANSFORM = "__edusphere_transform__";

export const FieldValue = {
  serverTimestamp: () => ({ [TRANSFORM]: "serverTimestamp" }),
  delete: () => ({ [TRANSFORM]: "delete" }),
  arrayUnion: (...values: unknown[]) => ({ [TRANSFORM]: "arrayUnion", values }),
};
