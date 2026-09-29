import { validateTimeRange, parseTime } from './time.utils.js';
import { BadRequestException } from '@nestjs/common';
import { describe, it, expect } from 'vitest';

describe('Time Utils', () => {
  describe('parseTime', () => {
    it('should parse HH:mm correctly', () => {
      const time = parseTime('14:30');
      expect(time.getUTCHours()).toBe(14);
      expect(time.getUTCMinutes()).toBe(30);
    });
  });

  describe('validateTimeRange', () => {
    it('should pass for valid time range', () => {
      const result = validateTimeRange('09:00', '18:00');
      expect(result.inicio.getUTCHours()).toBe(9);
      expect(result.fin.getUTCHours()).toBe(18);
    });

    it('should throw BadRequestException if inicio >= fin', () => {
      expect(() => validateTimeRange('18:00', '09:00')).toThrowError(BadRequestException);
      expect(() => validateTimeRange('12:00', '12:00')).toThrowError(BadRequestException);
    });
  });
});
