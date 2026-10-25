import { describe, expect, it } from 'vitest';
import { fieldKey } from './form-manager';

describe('fieldKey', () => {
  it('derives a stable answer key from a field label', () => {
    expect(fieldKey('Registration number')).toBe('registration_number');
    expect(fieldKey('  E-mail address! ')).toBe('e_mail_address');
    expect(fieldKey('2nd contact')).toBe('f_2nd_contact');
    expect(fieldKey('***')).toBe('field');
  });

  it('avoids keys already used on the form', () => {
    expect(fieldKey('Name', ['name', 'name_2'])).toBe('name_3');
  });
});
