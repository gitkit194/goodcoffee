// Stand-in for supabase-js in edge function tests: a signed-in user and an rpc() that records its calls.
// claim_ai_call answers state.claim (default: granted).
export function createClient() {
  const state = globalThis.__edge;
  return {
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (name, args) => {
      state.rpc.push({ name, args });
      if (name === 'claim_ai_call') return { data: state.claim ?? { id: 1, refused: null }, error: null };
      return { data: null, error: null };
    },
  };
}
