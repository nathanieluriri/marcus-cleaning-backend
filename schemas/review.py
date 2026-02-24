# ============================================================================
#REVIEW SCHEMA 
# ============================================================================
# This file was auto-generated on: 2026-02-23 22:45:34 WAT
# It contains Pydantic classes  database
# for managing attributes and validation of data in and out of the MongoDB database.
#
# ============================================================================

from schemas.imports import *
from pydantic import AliasChoices, ConfigDict, Field
import time

class ReviewBase(BaseModel):
    customer_id:str
    booking_id:str
    comment:str
    stars:int=Field(ge=0,le=5)

class ReviewCreate(ReviewBase):
    # Add other fields here
    cleaner_id:str 
    date_created: int = Field(default_factory=lambda: int(time.time()))
    last_updated: int = Field(default_factory=lambda: int(time.time()))

class ReviewUpdate(BaseModel):
    # Add other fields here 
    last_updated: int = Field(default_factory=lambda: int(time.time()))

class ReviewOut(ReviewBase):
    # Add other fields here
    cleaner_id:str 
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
            
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )
        
class RatingBreakdown(BaseModel):
    one_star: int = Field(default=0)
    two_star: int = Field(default=0)
    three_star: int = Field(default=0)
    four_star: int = Field(default=0)
    five_star: int = Field(default=0)
    
    
class ReviewRatingSummary(BaseModel):
    avg_ratings:int
    total_ratings:int
    rating_breakdown: RatingBreakdown
    
