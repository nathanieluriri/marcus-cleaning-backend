import { Html, Head, Body, Container, Heading, Text, Button, Section } from '@react-email/components'

/**
 * Password change / reset email. Ported from `email_templates/changing_password_template.py`.
 * Marcus Cleaning branding; sender display name comes from EMAIL_FROM.
 * See: docs/migration/08-email-resend.md
 */

export interface PasswordResetEmailProps {
  userEmail: string
  resetUrl: string
}

export function PasswordResetEmail({ userEmail, resetUrl }: PasswordResetEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>Reset your Marcus Cleaning password</Heading>
          <Text style={text}>
            We received a request to reset the password for {userEmail}. Click the button below to choose a new
            password.
          </Text>
          <Section style={btnWrap}>
            <Button href={resetUrl} style={button}>
              Reset password
            </Button>
          </Section>
          <Text style={muted}>
            This link expires shortly. If you didn&apos;t request a password reset, you can safely ignore this email
            and your password will remain unchanged.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const body = { backgroundColor: '#f4f6f8', fontFamily: 'Arial, sans-serif' }
const container = { backgroundColor: '#ffffff', padding: '32px', borderRadius: '8px', maxWidth: '480px' }
const heading = { fontSize: '20px', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#334155', lineHeight: '22px' }
const btnWrap = { textAlign: 'center' as const, margin: '24px 0' }
const button = {
  backgroundColor: '#0f172a',
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '6px',
  fontSize: '14px',
  textDecoration: 'none',
}
const muted = { fontSize: '12px', color: '#64748b', lineHeight: '18px' }

export default PasswordResetEmail
