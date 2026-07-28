declare module "plotly.js/dist/plotly" {
  const Plotly: {
    restyle: (
      graphDiv: unknown,
      update: Record<string, unknown>,
      traces?: number | number[],
    ) => Promise<unknown>;
  };
  export default Plotly;
}
