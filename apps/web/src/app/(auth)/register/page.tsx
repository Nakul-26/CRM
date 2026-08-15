"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { registerOrganizationSchema, type RegisterOrganizationInput } from "@sales-platform/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRegisterOrganization } from "@/hooks/use-auth";
import { ApiError } from "@/lib/http";

export default function RegisterPage() {
  const router = useRouter();
  const registerOrg = useRegisterOrganization();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterOrganizationInput>({ resolver: zodResolver(registerOrganizationSchema) });

  const onSubmit = async (values: RegisterOrganizationInput) => {
    setServerError(null);
    try {
      await registerOrg.mutateAsync(values);
      router.push("/");
    } catch (err) {
      setServerError(err instanceof ApiError ? err.body.error.message : "Something went wrong");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your organization</CardTitle>
          <CardDescription>You'll be the Owner — you can invite your team after.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="organizationName">Organization name</Label>
              <Input id="organizationName" {...register("organizationName")} />
              {errors.organizationName && (
                <p className="text-xs text-destructive">{errors.organizationName.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fullName">Your name</Label>
              <Input id="fullName" {...register("fullName")} />
              {errors.fullName && <p className="text-xs text-destructive">{errors.fullName.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" {...register("email")} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>
            {serverError && <p className="text-sm text-destructive">{serverError}</p>}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create organization"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <a href="/login" className="font-medium text-foreground underline underline-offset-4">
              Sign in
            </a>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
