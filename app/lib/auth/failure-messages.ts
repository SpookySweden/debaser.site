/**
 * What a sign-up failure says to the visitor.
 *
 * Most of Supabase's own messages are fine as they are - they are short, and the
 * form shows them unchanged ("User already registered", "Password should be...").
 * Three are not, because the visitor can do nothing with them:
 *
 *   - "Error sending confirmation email": the archive's mail service is misconfigured
 *     or rate-limited. The account is rolled back, so nothing was created - which is
 *     the part the visitor needs to hear, and the raw message does not say it.
 *   - "email rate limit exceeded": a limit on the *project*, not on the visitor.
 *   - "Email address \"...\" is invalid": Supabase refuses an address whose domain has
 *     no mail records, and the message reads like the visitor typed it wrong.
 *
 * All three are the archive's problem rather than the visitor's, so all three are
 * said in the archive's voice, and each one says whether anything changed.
 */
export function describeSignUpFailure(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('sending') && lower.includes('email')) {
    return "THE CONFIRMATION MAIL COULD NOT BE SENT, SO NOTHING WAS CREATED. THE ARCHIVE'S MAIL SERVICE IS BEING SORTED OUT - PLEASE TRY AGAIN LATER.";
  }

  if (lower.includes('rate limit')) {
    return 'TOO MANY ACCOUNTS HAVE BEEN MADE IN THE LAST HOUR - PLEASE TRY AGAIN SOON.';
  }

  if (lower.includes('invalid') && lower.includes('email')) {
    return 'THAT ADDRESS CANNOT RECEIVE MAIL, SO A CONFIRMATION LINK WOULD GO NOWHERE. CHECK THE SPELLING AND USE AN INBOX THAT WORKS.';
  }

  return message.toUpperCase();
}
