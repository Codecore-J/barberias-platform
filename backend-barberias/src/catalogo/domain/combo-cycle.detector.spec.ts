import { BadRequestException } from '@nestjs/common';
import { ComboCycleDetector } from './combo-cycle.detector.js';

describe('ComboCycleDetector', () => {
  it('should pass for a single combo with no subcombos', () => {
    const adjList = {
      A: [],
    };
    expect(() => ComboCycleDetector.validateNoCycles(adjList)).not.toThrow();
  });

  it('should pass for a valid simple tree (A -> B, A -> C)', () => {
    const adjList = {
      A: ['B', 'C'],
      B: [],
      C: [],
    };
    expect(() => ComboCycleDetector.validateNoCycles(adjList)).not.toThrow();
  });

  it('should pass for a valid multi-level acyclic graph (A -> B -> C, A -> C)', () => {
    const adjList = {
      A: ['B', 'C'],
      B: ['C'],
      C: [],
    };
    expect(() => ComboCycleDetector.validateNoCycles(adjList)).not.toThrow();
  });

  it('should throw BadRequestException if a combo references itself (A -> A)', () => {
    const adjList = {
      A: ['A'],
    };
    expect(() => ComboCycleDetector.validateNoCycles(adjList)).toThrow(
      BadRequestException,
    );
  });

  it('should throw BadRequestException on a simple cycle (A -> B, B -> A)', () => {
    const adjList = {
      A: ['B'],
      B: ['A'],
    };
    expect(() => ComboCycleDetector.validateNoCycles(adjList)).toThrow(
      BadRequestException,
    );
  });

  it('should throw BadRequestException on a deep cycle (A -> B -> C -> D -> A)', () => {
    const adjList = {
      A: ['B'],
      B: ['C'],
      C: ['D'],
      D: ['A'],
    };
    expect(() => ComboCycleDetector.validateNoCycles(adjList)).toThrow(
      BadRequestException,
    );
  });

  it('should pass for multiple disconnected acyclic graphs', () => {
    const adjList = {
      A: ['B'],
      B: [],
      X: ['Y'],
      Y: ['Z'],
      Z: [],
    };
    expect(() => ComboCycleDetector.validateNoCycles(adjList)).not.toThrow();
  });

  it('should throw if any of the disconnected graphs has a cycle', () => {
    const adjList = {
      A: ['B'],
      B: [],
      X: ['Y'],
      Y: ['Z'],
      Z: ['X'], // cycle here
    };
    expect(() => ComboCycleDetector.validateNoCycles(adjList)).toThrow(
      BadRequestException,
    );
  });
});
