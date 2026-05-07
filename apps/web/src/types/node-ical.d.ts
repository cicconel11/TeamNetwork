declare module "node-ical" {
  const ical: {
    parseICS: (icsText: string) => Record<string, unknown>;
  };

  export default ical;
}
