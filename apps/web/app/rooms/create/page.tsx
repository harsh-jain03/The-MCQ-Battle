'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CreateRoomFormData, ValidationErrors } from '@/types';

interface FormInputProps {
  id: string;
  label: string;
  type?: string;
  value: string | number;
  onChange: (value: string | number) => void;
  error?: string;
  required?: boolean;
  min?: string | number;
  max?: string | number;
  maxLength?: number;
  minLength?: number;
  placeholder?: string;
  className?: string;
  children?: React.ReactNode;
}

const FormInput = ({
  id,
  label,
  type = 'text',
  value,
  onChange,
  error,
  required = false,
  min,
  max,
  maxLength,
  minLength,
  placeholder,
  className = '',
  children,
}: FormInputProps) => (
  <div className="space-y-1">
    <label htmlFor={id} className="block text-sm font-medium text-gray-700">
      {label}
    </label>
    <div className="relative">
      <input
        type={type}
        id={id}
        value={value}
        onChange={(e) => onChange(type === 'number' ? parseInt(e.target.value) : e.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`mt-1 block w-full rounded-md shadow-sm border ${
          error
            ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
            : 'border-gray-300 focus:border-indigo-500 focus:ring-indigo-500'
        } focus:ring-2 focus:ring-offset-2 pr-10 px-4 py-2 ${className}`}
        placeholder={placeholder}
        required={required}
        min={min}
        max={max}
        maxLength={maxLength}
        minLength={minLength}
      />
      {children && <div className="absolute inset-y-0 right-0 flex items-center pr-3">{children}</div>}
    </div>
    {error && (
      <p id={`${id}-error`} className="text-sm text-red-600 animate-fade-in">
        {error}
      </p>
    )}
  </div>
);

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

const PasswordInput = ({ value, onChange, error }: PasswordInputProps) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="space-y-1">
      <FormInput
        id="password"
        label="Password (Optional)"
        type={showPassword ? 'text' : 'password'}
        value={value}
        onChange={(val) => onChange(val.toString())}
        error={error}
        placeholder="Enter room password"
        minLength={4}
      >
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="text-gray-400 hover:text-gray-600 focus:outline-none"
        >
          {showPassword ? (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
              />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
            </svg>
          )}
        </button>
      </FormInput>
      <p className="text-sm text-gray-500">
        If set, players will need this password to join the room
      </p>
    </div>
  );
};

export default function CreateRoomPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [formData, setFormData] = useState<CreateRoomFormData>({
    name: '',
    maxPlayers: 4,
    password: '',
  });

  const validateField = (name: keyof CreateRoomFormData, value: string | number): string | undefined => {
    switch (name) {
      case 'name':
        if (!value.toString().trim()) return 'Room name is required';
        if (value.toString().length > 50) return 'Room name must be less than 50 characters';
        break;
      case 'maxPlayers':
        if (typeof value !== 'number' || value < 2 || value > 10)
          return 'Maximum players must be between 2 and 10';
        break;
      case 'password':
        if (value && value.toString().length < 4)
          return 'Password must be at least 4 characters if provided';
        break;
    }
  };

  const handleFieldChange = (name: keyof CreateRoomFormData, value: string | number) => {
    setFormData(prev => ({ ...prev, [name]: value }));
    const error = validateField(name, value);
    setValidationErrors(prev => ({ ...prev, [name]: error }));
  };

  const hasErrors = Object.values(validationErrors).some(Boolean);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    const errors: ValidationErrors = {};
    for (const [key, value] of Object.entries(formData)) {
      const err = validateField(key as keyof CreateRoomFormData, value);
      if (err) errors[key as keyof CreateRoomFormData] = err;
    }

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      const firstInvalid = Object.keys(errors)[0];
      if (firstInvalid) document.getElementById(firstInvalid)?.focus();
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          maxPlayers: formData.maxPlayers,
          password: formData.password.trim() || undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Failed to create room');

      setSuccess('Room created successfully! Redirecting...');
      setTimeout(() => router.push(`/rooms/${data.id}`), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Create New Room</h1>
          <Link href="/rooms" className="text-gray-600 hover:text-gray-900">
            Back to Rooms
          </Link>
        </div>

        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-md animate-fade-in">
            <p className="text-green-700">{success}</p>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md animate-fade-in">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        <div className="bg-white shadow rounded-lg p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <FormInput
              id="name"
              label="Room Name"
              value={formData.name}
              onChange={(value) => handleFieldChange('name', value)}
              error={validationErrors.name}
              required
              maxLength={50}
              placeholder="Enter room name"
            />

            <FormInput
              id="maxPlayers"
              label="Maximum Players"
              type="number"
              value={formData.maxPlayers}
              onChange={(value) => handleFieldChange('maxPlayers', value)}
              error={validationErrors.maxPlayers}
              required
              min={2}
              max={10}
            >
            </FormInput>

            <PasswordInput
              value={formData.password}
              onChange={(value) => handleFieldChange('password', value)}
              error={validationErrors.password}
            />

            <button
              type="submit"
              disabled={isSubmitting || hasErrors}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 transition-all duration-200"
            >
              {isSubmitting ? 'Creating Room...' : 'Create Room'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}