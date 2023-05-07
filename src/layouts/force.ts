import { Ref, toRef, watch } from "vue"
import * as d3 from "d3-force"
import { Edges, NodePositions, Nodes, Position } from "@/common/types"
import { OnClickHandler, OnDragHandler } from "@/common/types"
import { LayoutActivateParameters, LayoutHandler } from "./handler"

export interface ForceNodeDatum extends d3.SimulationNodeDatum {
  id: string
}

export interface ForceEdgeDatum {
  source: string
  target: string
}

type d3Type = typeof d3

type CreateSimulationFunction = (
  d3: d3Type,
  nodes: ForceNodeDatum[],
  edges: ForceEdgeDatum[]
) => d3.Simulation<ForceNodeDatum, ForceEdgeDatum>

export type ForceLayoutParameters = {
  positionFixedByDrag?: boolean
  positionFixedByClickWithAltKey?: boolean
  noAutoRestartSimulation?: boolean
  createSimulation?: CreateSimulationFunction
}

export class ForceLayout implements LayoutHandler {
  private onDeactivate?: () => void
  private onTick?: () => void
  private simulation?: d3.Simulation<ForceNodeDatum, ForceEdgeDatum>
  private parameters?: LayoutActivateParameters

  constructor(private options: ForceLayoutParameters = {}) {}

  activate(parameters: LayoutActivateParameters): void {
    this.parameters = parameters

    const { nodePositions, nodes, edges, emitter, svgPanZoom } = parameters
    let { nodeLayouts, nodeLayoutMap } = this.buildNodeLayouts(nodes.value, nodePositions, {
      x: 0,
      y: 0,
    })

    const simulation = this.createSimulation(
      nodeLayouts,
      this.forceLayoutEdges(edges.value, nodes.value)
    )
    this.simulation = simulation
    this.onTick = () => {
      for (const node of nodeLayouts) {
        const layout = nodePositions.value?.[node.id]
        if (layout) {
          const x = node.x ?? 0
          const y = node.y ?? 0
          if (layout.x !== x) layout.x = x
          if (layout.y !== x) layout.y = y
        }
      }
    }
    simulation.on("tick", this.onTick)

    // for ticked manually
    this.onTick()

    const restartSimulation = () => {
      if (!this.options.noAutoRestartSimulation) {
        simulation.alpha(0.1).restart()
      }
    }

    const onDrag: OnDragHandler = positions => {
      if (this.options.noAutoRestartSimulation) {
        for (const [id, pos] of Object.entries(positions)) {
          const nodePos = nodePositions.value?.[id]
          nodePos.x = pos.x
          nodePos.y = pos.y
        }
      } else {
        for (const [id, pos] of Object.entries(positions)) {
          const nodePos = nodeLayoutMap[id]
          nodePos.fx = pos.x
          nodePos.fy = pos.y
        }
        restartSimulation()
      }
    }

    const onDragEnd: OnDragHandler = positions => {
      for (const [id, pos] of Object.entries(positions)) {
        const layout = this.getNodeLayout(nodePositions, id)
        const nodePos: d3.SimulationNodeDatum = nodeLayoutMap?.[id] ?? { x: 0, y: 0 }
        if (layout.value.fixed || this.options.positionFixedByDrag) {
          nodePos.fx = pos.x
          nodePos.fy = pos.y
          layout.value.fixed = true
        } else {
          nodePos.x = pos.x
          nodePos.y = pos.y
          delete nodePos.fx
          delete nodePos.fy
        }
      }
      restartSimulation()
    }

    const onClick: OnClickHandler = ({ node, event }) => {
      if (this.options.positionFixedByClickWithAltKey && event.altKey) {
        const layout = this.getNodeLayout(nodePositions, node)
        let nodePos: ForceNodeDatum | undefined = nodeLayoutMap?.[node]
        if (!nodePos) {
          nodePos = { id: node, x: 0, y: 0 }
          nodeLayoutMap[node] = nodePos
        }

        if (layout.value.fixed) {
          // unfix
          delete layout.value.fixed
          nodePos.x = nodePos.fx || nodePos.x
          nodePos.y = nodePos.fy || nodePos.y
          delete nodePos.fx
          delete nodePos.fy
        } else {
          // fix
          layout.value.fixed = true
          nodePos.fx = nodePos.x
          nodePos.fy = nodePos.y
        }
        restartSimulation()
      }
    }

    const stopNetworkWatch = watch(
      () => [
        Object.keys(nodes.value),
        // Watch only for changes in links, not all properties of the edge objects.
        Object.values(edges.value).map(e => `${e.source}=${e.target}`),
      ],
      () => {
        // set new node's position to center of the view
        const area = svgPanZoom.getViewArea()
        ;({ nodeLayouts, nodeLayoutMap } = this.buildNodeLayouts(
          nodes.value,
          nodePositions,
          area.center
        ))
        simulation.nodes(nodeLayouts)
        const forceEdges = simulation.force<d3.ForceLink<ForceNodeDatum, ForceEdgeDatum>>("edge")
        if (forceEdges) {
          forceEdges.links(this.forceLayoutEdges(edges.value, nodes.value))
        }
        restartSimulation()
      }
    )

    emitter.on("node:dragstart", onDrag)
    emitter.on("node:pointermove", onDrag)
    emitter.on("node:dragend", onDragEnd)
    emitter.on("node:click", onClick)

    this.onDeactivate = () => {
      simulation.stop()
      stopNetworkWatch()
      emitter.off("node:dragstart", onDrag)
      emitter.off("node:pointermove", onDrag)
      emitter.off("node:dragend", onDragEnd)
      emitter.off("node:click", onClick)
    }
  }

  deactivate(): void {
    if (this.onDeactivate) {
      this.onDeactivate()
    }
  }

  ticked(ticks: number = 100): void {
    this.deactivate()

    if (this.parameters)
      this.activate(this.parameters)

    this.simulation?.alpha(1).stop().tick(ticks)

    if (this.onTick) {
      this.onTick()
    }

    this.deactivate()
  }

  private createSimulation(
    nodes: ForceNodeDatum[],
    edges: ForceEdgeDatum[]
  ): d3.Simulation<ForceNodeDatum, ForceEdgeDatum> {
    if (this.options.createSimulation) {
      return this.options.createSimulation(d3, nodes, edges)
    } else {
      const forceLink = d3.forceLink<ForceNodeDatum, ForceEdgeDatum>(edges).id(d => d.id)
      return d3
        .forceSimulation(nodes)
        .nodes(nodes)
        .force("edge", forceLink.distance(100))
        .force("charge", d3.forceManyBody())
        .force("collide", d3.forceCollide(50).strength(0.2))
        .force("center", d3.forceCenter().strength(0.05))
        .alphaMin(0.001)
    }
  }

  private buildNodeLayouts(
    nodes: Readonly<Nodes>,
    nodePositions: Ref<NodePositions>,
    newPosition: Position
  ) {
    const newNodes = Object.keys(nodes).filter(n => !(n in nodePositions.value))
    for (const nodeId of newNodes) {
      nodePositions.value[nodeId] = { ...newPosition }
    }

    const nodeLayouts = this.forceNodeLayouts(nodePositions.value)
    const nodeLayoutMap = Object.fromEntries(nodeLayouts.map(n => [n.id, n]))
    return { nodeLayouts, nodeLayoutMap }
  }

  private forceNodeLayouts(layouts: NodePositions): ForceNodeDatum[] {
    return Object.entries(layouts).map(([id, v]) => {
      return v.fixed ? { id, ...v, fx: v.x, fy: v.y } : { id, ...v }
    })
  }

  private forceLayoutEdges(edges: Edges, nodes: Nodes): ForceEdgeDatum[] {
    // d3-force replaces the source/target in the edge with NodeDatum
    // objects, so build own link objects.
    return Object.values(edges)
      .filter(edge => edge.source in nodes && edge.target in nodes)
      .map(v => ({
        source: v.source,
        target: v.target,
      }))
  }

  private getNodeLayout(nodePositions: Ref<NodePositions>, node: string) {
    const layout = toRef(nodePositions.value, node)
    if (!layout.value) {
      layout.value = { x: 0, y: 0 }
    }
    return layout
  }
}
