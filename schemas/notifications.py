# ============================================================================
#NOTIFICATIONS SCHEMA 
# ============================================================================
# This file was auto-generated on: 2026-03-06 08:55:46 WAT
# It contains Pydantic classes  database
# for managing attributes and validation of data in and out of the MongoDB database.
#
# ============================================================================

from schemas.imports import *
from pydantic import AliasChoices, Field
import time

class NotificationsBase(BaseModel):
    # Add other fields here
    type: NotificationType
    title: NotificationTitle
    message:str
    isRead:bool
    pass

class NotificationsCreate(NotificationsBase):
    # Add other fields here 
    date_created: int = Field(default_factory=lambda: int(time.time()))
    last_updated: int = Field(default_factory=lambda: int(time.time()))

class NotificationsUpdate(BaseModel):
    # Add other fields here 
    last_updated: int = Field(default_factory=lambda: int(time.time()))

class NotificationsOut(NotificationsBase):
    # Add other fields here 
    id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("_id", "id"),
        serialization_alias="id",
    )
    date_created: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("date_created", "dateCreated"),
        serialization_alias="dateCreated",
    )
    last_updated: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("last_updated", "lastUpdated"),
        serialization_alias="lastUpdated",
    )
    
    @model_validator(mode="before")
    @classmethod
    def convert_objectid(cls, values):
        if "_id" in values and isinstance(values["_id"], ObjectId):
            values["_id"] = str(values["_id"])  # coerce to string before validation
        return values
            
    class Config:
        populate_by_name = True  # allows using `id` when constructing the model
        arbitrary_types_allowed = True  # allows ObjectId type
        json_encoders ={
            ObjectId: str  # automatically converts ObjectId → str
        }