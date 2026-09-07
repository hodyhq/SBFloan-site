/**
 * Validation rules for the Interest-Free Loan application. These are the rules
 * that keep bad data out of a real person's inbox — worth a test each.
 */
import { validate } from './apply.js';
import assert from 'node:assert/strict';
const base = { name:'A B', dob:'1990-01-01', phone:'1', email:'a@b.co', address:'x',
  marital:'Married', dependents:'2', amount:'$100', purpose:'p', neededBy:'2026-10-01',
  monthlyRepay:'$50', guarantors:'Yes, I can provide one guarantor', overdue:'No',
  bankruptcy:'No', openToContact:'Yes', signature:'A B', declaration:true };

assert.equal(validate(base).errors.length, 0, 'a complete application should pass');
assert.ok(validate({...base, marital:'Complicated'}).errors.includes('marital'), 'enum enforced');
assert.ok(validate({...base, dob:'17/04/1986'}).errors.includes('dob'), 'date format enforced');
assert.ok(validate({...base, dependents:'many'}).errors.includes('dependents'), 'digits enforced');
assert.ok(validate({...base, declaration:false}).errors.includes('declaration'), 'declaration required');
assert.ok(validate({...base, overdue:'Yes'}).errors.includes('overdueDetail'),
  'saying yes to overdue bills makes the explanation mandatory');
assert.equal(validate({...base, overdue:'Yes', overdueDetail:'behind on rent'}).errors.length, 0);
assert.equal(validate(base).data.dob, 'January 1, 1990', 'dates are humanised for the PDF');
const injected = validate({...base, name:'X\r\nBcc: evil@example.com'});
assert.ok(!injected.data.name.includes('\n'), 'CRLF cannot survive into the subject line');
console.log('apply validation: all checks pass');
