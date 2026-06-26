declare module "osm-pbf-parser" {
  import type { Transform } from "node:stream";

  function parseOSM(): Transform;
  export = parseOSM;
}
