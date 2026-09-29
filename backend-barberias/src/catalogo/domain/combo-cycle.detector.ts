import { BadRequestException } from '@nestjs/common';

export class ComboCycleDetector {
  /**
   * Detecta ciclos en una jerarquía de combos utilizando DFS (Depth First Search).
   * 
   * @param adjacencyList Un registro u objeto donde la clave es el ID del combo y el valor es un array con los IDs de los subcombos directos.
   * @throws BadRequestException si se detecta un ciclo.
   */
  static validateNoCycles(adjacencyList: Record<string, string[]>): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      if (recursionStack.has(nodeId)) {
        return true; // Ciclo detectado
      }
      
      if (visited.has(nodeId)) {
        return false; // Ya explorado, sin ciclos desde aquí
      }

      visited.add(nodeId);
      recursionStack.add(nodeId);

      const neighbors = adjacencyList[nodeId] || [];
      for (const neighbor of neighbors) {
        if (dfs(neighbor)) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of Object.keys(adjacencyList)) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId)) {
          throw new BadRequestException(
            'Se detectó un ciclo infinito en la configuración de los combos.'
          );
        }
      }
    }
  }
}
