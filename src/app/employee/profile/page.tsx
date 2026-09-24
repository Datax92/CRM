"use client";

import { MyProfileView } from "@/components/employees/MyProfileView";

/** The profile the admin opens from Team, about the person reading it. */
export default function MyProfilePage() {
  return <MyProfileView scope="employee" />;
}
