/**
 * FICTIONAL TEST DATA — not the event's registrations.
 *
 * Every name, enrollment number, phone number and email below is invented and
 * uses reserved example domains. It mimics the shape of the real form export —
 * including the untidy parts the app has to survive: headers with trailing and
 * non-breaking spaces and odd capitalization, mixed-case and padded emails, a
 * ragged row (Google omits trailing empty cells), a blank row, an invalid and
 * a missing email, a repeat submission, a same-person resubmission with
 * reworded details, and one email shared by two different people.
 */

export const TEST_SHEET_ID = '1FakeSheetIdUsedOnlyByAutomatedTests000000';
export const TEST_TAB = 'Form responses 1';

export const HEADER_ROW = [
  'Timestamp',
  'Full Name ',
  'E-mail address',
  'Enrollment Number ',
  'SEMESTER',
  'course',
  'Specialization ',
  'Phone number',
];

export const REGISTRATION_ROWS = [
  HEADER_ROW,
  /* row 2 */ ['07/10/2026 10:00:00', 'Asha Verma', 'Asha.Verma@Example.com', 'EN2026001', '3', 'B.Tech', 'Data Science', '9000000001'],
  /* row 3 */ ['07/10/2026 10:05:00', 'Rohan Mehta', '  rohan.mehta@example.org ', 'EN2026002', '5', 'B.Tech', 'AIML', '9000000002'],
  /* row 4 */ ['07/10/2026 10:10:00', 'Meera Iyer', 'meera@example.com', 'EN2026004', '7', 'MCA'],
  /* row 5 */ ['07/10/2026 10:15:00', 'Bad Address', 'not-an-email', 'EN2026005', '1', 'BCA', 'Core', '9000000005'],
  /* row 6 */ ['07/10/2026 10:20:00', 'No Address', '', 'EN2026006', '1', 'BCA', 'Core', '9000000006'],
  /* row 7 */ ['08/10/2026 09:00:00', 'Rohan Mehta', 'ROHAN.MEHTA@example.org', 'EN2026002', '5', 'B.Tech', 'AIML', '9000000002'],
  /* row 8 */ ['08/10/2026 09:30:00', 'Neha Kapoor', 'neha@example.com', 'EN2026008', '3', 'ECE', 'Cloud computing', '9000000008'],
  /* row 9 */ ['09/10/2026 11:00:00', 'Neha  Kapoor', 'neha@example.com', 'EN2026008', '3', 'Btech ECE', 'Google cloud', '9000000008'],
  /* row 10 */ ['09/10/2026 12:00:00', 'Arjun Rao', 'shared@example.com', 'EN2026010', '5', 'B.Tech', 'CSE', '9000000010'],
  /* row 11 */ ['09/10/2026 12:05:00', 'Divya Rao', 'shared@example.com', 'EN2026011', '3', 'B.Tech', 'CSE', '9000000011'],
  /* row 12 */ ['', '', '', '', '', '', '', ''],
  /* row 13 */ ['10/10/2026 08:00:00', 'Vikram Nair', ' vikram@example.com', 'EN2026013', '1', 'B.Tech', 'Cybersecurity', '9000000013'],
];

/** Every phone number in the fixture — none may ever appear in API output. */
export const FIXTURE_PHONES = REGISTRATION_ROWS.slice(1)
  .map((row) => row[7])
  .filter(Boolean);
