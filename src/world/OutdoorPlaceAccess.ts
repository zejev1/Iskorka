import { buildingSize, buildingPolygon, pointInPolygon } from './BuildingFootprints';
import { terrainPlotIsDry } from './geography/WorldTerrain';
import type { WorldPoint2D, WorldState } from './types';

/** A garden is an area, not the solid centre of an overlapping house. Repair
 * a separate reachable entrance within 30 metres of the same site. Original
 * place coordinates, buildings, terrain and every resident remain fixed. */
export function repairOutdoorPlaceAccess(world: WorldState,
  moved: Map<string,{before:WorldPoint2D;after:WorldPoint2D}>,
): boolean {
  const buildings=Object.values(world.places).filter(p=>buildingSize(p).width>0);
  let changed=false;
  for(const place of Object.values(world.places)) {
    if(!['quiet_space','cemetery'].includes(place.kind))continue;
    const original={x:place.mapX,y:place.mapY};
    const nearby=buildings.filter(p=>Math.hypot(p.mapX-original.x,p.mapY-original.y)<0.5);
    const clear=(p:WorldPoint2D)=>nearby.every(b=>!pointInPolygon(p,buildingPolygon(b,0.025)));
    if(place.outdoorAccessPointV1 && clear(place.outdoorAccessPointV1))continue;
    if(clear(original))continue;
    // A saved person/trip is never moved by a geometry repair. Defer occupied sites.
    if(Object.values(world.agents).some(a=>a.life.alive&&(a.locationId===place.id||a.movement?.targetPlaceId===place.id)))continue;
    const centre=world.places[place.connectedPlaceIds[0]];
    const angle=centre?Math.atan2(centre.mapY-original.y,centre.mapX-original.x):0;
    let candidate:WorldPoint2D|undefined;
    for(let ring=1;ring<=6&&!candidate;ring++)for(let i=0;i<16;i++) {
      const bearing=angle+i*Math.PI/8;
      const point={x:original.x+Math.cos(bearing)*ring*0.05,y:original.y+Math.sin(bearing)*ring*0.05};
      if(clear(point)&&terrainPlotIsDry(world.places,point,0.025)){candidate=point;break;}
    }
    if(!candidate)continue;
    place.outdoorAccessPointV1=candidate;
    moved.set(place.id,{before:original,after:candidate});changed=true;
  }
  return changed;
}
