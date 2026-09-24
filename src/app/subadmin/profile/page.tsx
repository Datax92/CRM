"use client";

import { MyProfileView } from "@/components/employees/MyProfileView";

/** A manager's own profile — themselves and their team — as the admin sees it. */
export default function MyProfilePage() {
  return <MyProfileView scope="subadmin" />;
}
